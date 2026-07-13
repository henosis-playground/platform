import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runGate } from "../src/gate.js";
import { inspectNativeComponentSpecs } from "../src/inspect.js";

const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("widened merge gate", () => {
  it("blocks on a prod-only invalid HPA row after dev passes", async () => {
    const fixture = await makeGateFixture();
    const result = await runGate(fixture.options);

    expect(result.cells.map((cell) => [cell.environment, cell.ok])).toEqual([
      ["dev", true],
      ["prod", false],
      ["preview_3jhc7x633z88188fzqhcbbrf84", true],
    ]);
    expect(result.report.ok).toBe(false);
    expect(result.report.failures[0]).toMatchObject({
      consumer: "service-a",
      kind: "render",
      message:
        "replicas.min must not exceed replicas.max (environment: prod; stage: build)",
    });
    expect(result.report.failures[0]).not.toHaveProperty("stage");
    expect(result.cells[1]?.failures[0]).toMatchObject({
      stage: "build",
      excerpt: expect.stringContaining("Pipeline stage: build"),
    });
    expect(result.cells[1]?.failures[0]?.excerpt).toContain(
      "Environment: prod",
    );
    expect(Object.keys(result.report).sort()).toEqual(["failures", "ok"]);
    expect(result.text).toContain("prod: FAIL");
  });

  it("kill switch reduces execution to the unconditional dev cell", async () => {
    const fixture = await makeGateFixture();
    const result = await runGate({ ...fixture.options, widenedGate: false });

    expect(result.report).toEqual({ ok: true, failures: [] });
    expect(result.cells).toEqual([
      { environment: "dev", ok: true, failures: [] },
    ]);
  });

  it("checks Cloudflare definitions without sending them through Kubernetes", async () => {
    const fixture = await makeCloudflareGateFixture();
    const result = await runGate(fixture.options);

    expect(result.report).toEqual({ ok: true, failures: [] });
    expect(result.cells.map((cell) => [cell.environment, cell.ok])).toEqual([
      ["dev", true],
      ["prod", true],
      ["preview_3jhc7x633z88188fzqhcbbrf84", true],
    ]);
    expect(result.text).toContain(
      "each repository's henosis.ts executed separately",
    );
    expect(result.text).toContain("Native platform proof");
    expect(result.text).not.toContain("Kubernetes");
  });

  it("executes a Supabase definition and checksums referenced native SQL", async () => {
    const fixture = await makeSupabaseFixture();
    const inspection = await inspectNativeComponentSpecs(
      fixture.manifestPath,
      fixture.scratchDir,
      { "service-d": fixture.componentDir },
    );
    const component = inspection.components["service-d"];
    const context = JSON.parse(
      Buffer.from(component?.connectorContext ?? "", "base64").toString("utf8"),
    );

    expect(component).toMatchObject({
      connector: "supabase",
      dependencies: ["service-a"],
      dependencySpecHashSlots: [
        {
          component: "service-a",
          pointer: "/migrations/0/inputs/0/producerComponentSpecHash",
        },
      ],
    });
    expect(context).toMatchObject({
      resourceId: "service_d",
      api: { expose: true, anonAccess: "read" },
      migrations: [
        {
          id: "202607130001_create_items",
          checksum:
            "sha256:77f617c9e1a04d7aa174eaddb822f5805b0978c1bb886920d4e257149b589e96",
          sql: "create table service_d.items (id bigint primary key);\n",
          inputs: [
            {
              name: "upstream_url",
              producerComponentSpecHash: null,
              output: "api",
              default: null,
            },
          ],
        },
      ],
    });
  });

  it("representative preview materializes the candidate and borrows unchanged consenters", async () => {
    const fixture = await makeRepresentativeBorrowFixture();
    const result = await runGate(fixture.options);

    expect(result.report).toEqual({ ok: true, failures: [] });
    expect(result.cells.map((cell) => [cell.environment, cell.ok])).toEqual([
      ["dev", true],
      ["prod", true],
      ["preview_3jhc7x633z88188fzqhcbbrf84", true],
    ]);
  });
});

async function makeSupabaseFixture(): Promise<{
  manifestPath: string;
  scratchDir: string;
  componentDir: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "henosis-supabase-inspect-"));
  scratchDirs.push(root);
  const componentDir = path.join(root, "service-d");
  await mkdir(path.join(componentDir, "supabase", "migrations"), { recursive: true });
  await writeFile(
    path.join(componentDir, "henosis.ts"),
    `
      export default {
        kind: "supabase.database",
        outputs: {
          kind: "object",
          shape: {
            restUrl: { kind: "url" },
            schema: { kind: "string" },
            anonKeyRef: { kind: "secret-ref" },
          },
        },
        migrationsDir: "./supabase/migrations",
        schema: "service_d",
        api: { expose: true, anonAccess: "read" },
        migrationInputs: {
          "202607130001_create_items": {
            upstream_url: { kind: "url", component: "service-a", output: "api" },
          },
        },
        environments: ["dev", "prod", "preview"],
      };
    `,
  );
  await writeFile(
    path.join(
      componentDir,
      "supabase",
      "migrations",
      "202607130001_create_items.sql",
    ),
    "create table service_d.items (id bigint primary key);\n",
  );
  const manifestPath = path.join(root, "candidate.toml");
  await writeFile(
    manifestPath,
    `
      [environment]
      id = "dev"

      [components.service-d]
      repo = "henosis-playground/service-d"
      ref = "dddddddddddddddddddddddddddddddddddddddd"
      digest = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    `,
  );
  return {
    manifestPath,
    scratchDir: path.join(root, "scratch"),
    componentDir,
  };
}

async function makeCloudflareGateFixture(): Promise<{
  options: Parameters<typeof runGate>[0];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "henosis-cloudflare-gate-"));
  scratchDirs.push(root);
  const componentDir = path.join(root, "service-f");
  await mkdir(path.join(componentDir, "src"), { recursive: true });
  await writeFile(
    path.join(componentDir, "henosis.ts"),
    `
      export default {
        outputs: {
          kind: "object",
          shape: {
            url: { kind: "url", role: "ui" },
            workerName: { kind: "string" },
            deploymentId: { kind: "string" },
            versionId: { kind: "string" },
            claimUrl: { kind: "url" },
          },
        },
        inputs: {
          BACKEND_URL: { kind: "url", component: "service-a", output: "api" },
        },
        environments: ["dev", "prod", "preview"],
      };
    `,
  );
  await writeFile(
    path.join(componentDir, "wrangler.toml"),
    'name = "service-f"\nmain = "src/index.js"\n',
  );
  await writeFile(path.join(componentDir, "src", "index.js"), "export default {};\n");
  const manifestPath = path.join(root, "candidate.toml");
  const devManifestPath = path.join(root, "dev.toml");
  const manifest = `
    [environment]
    id = "dev"

    [components.service-f]
    repo = "henosis-playground/service-f"
    ref = "ffffffffffffffffffffffffffffffffffffffff"
    digest = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  `;
  await writeFile(manifestPath, manifest);
  await writeFile(devManifestPath, manifest);
  return {
    options: {
      manifestPath,
      devManifestPath,
      scratchDir: path.join(root, "scratch"),
      outputDir: path.join(root, "output"),
      localOverrides: { "service-f": componentDir },
    },
  };
}

async function makeGateFixture(): Promise<{
  options: Parameters<typeof runGate>[0];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "henosis-k8s-gate-"));
  scratchDirs.push(root);
  const scratchDir = path.join(root, "scratch");
  const outputDir = path.join(root, "output");
  const componentDir = path.join(root, "service-a");
  const manifestPath = path.join(root, "candidate.toml");
  const devManifestPath = path.join(root, "dev.toml");
  await mkdir(path.join(componentDir, "src"), { recursive: true });
  await writeFile(
    path.join(componentDir, "package.json"),
    `${JSON.stringify({
      name: "@henosis/service-a",
      version: "0.0.0",
      type: "module",
      exports: { ".": "./src/index.ts" },
      henosis: { component: "service-a" },
      dependencies: { "@henosis/platform-k8s": "*" },
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(componentDir, "src", "index.ts"),
    `
      import { defineComponent, h } from "@henosis/platform-k8s";

      export default defineComponent({
        outputs: h.object({ api: h.url() }),
        params: {
          dev: { replicas: { min: 1, max: 3, targetCpu: 70 } },
          prod: { replicas: { min: 5, max: 2, targetCpu: 70 } },
          preview: { replicas: { min: 1, max: 2, targetCpu: 70 } },
        },
        build: (ctx, params) => {
          const service = ctx.namespace("payments").service("api", {
            targetPort: 8080,
            replicas: params.replicas,
            resources: {
              requests: { cpu: "100m", memory: "128Mi" },
              limits: { cpu: "500m", memory: "512Mi" },
            },
          });
          return { api: service.url };
        },
      });
    `,
  );
  const manifest = `
    [environment]
    id = "dev"

    [components.service-a]
    repo = "henosis-playground/service-a"
    ref = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  `;
  await writeFile(manifestPath, manifest);
  await writeFile(devManifestPath, manifest);
  const platformRoot = platformRepoRoot();
  return {
    options: {
      manifestPath,
      devManifestPath,
      scratchDir,
      outputDir,
      localOverrides: {
        core: path.join(platformRoot, "packages", "core"),
        "platform-k8s": path.join(platformRoot, "packages", "platform-k8s"),
        "service-a": componentDir,
        typescript: path.join(platformRoot, "node_modules", "typescript"),
      },
    },
  };
}

async function makeRepresentativeBorrowFixture(): Promise<{
  options: Parameters<typeof runGate>[0];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "henosis-borrow-gate-"));
  scratchDirs.push(root);
  const scratchDir = path.join(root, "scratch");
  const outputDir = path.join(root, "output");
  const manifestPath = path.join(root, "candidate.toml");
  const devManifestPath = path.join(root, "dev.toml");
  const platformDir = path.join(root, "platform-mock");
  await mkdir(path.join(platformDir, "src"), { recursive: true });
  await writeFile(
    path.join(platformDir, "package.json"),
    `${JSON.stringify({
      name: "@henosis/platform-mock",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./src/index.ts" },
      henosis: { platform: true },
      dependencies: { "@henosis/core": "*" },
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(platformDir, "src", "index.ts"),
    `
      import {
        definePlatform,
        h,
        type BuildContext,
        type Environment,
      } from "@henosis/core";

      const stableEnvKinds = ["dev", "prod"] as const;
      type Env = Environment<(typeof stableEnvKinds)[number]>;
      const platform = definePlatform<typeof stableEnvKinds, BuildContext<Env>>({
        identity: {
          packageName: "@henosis/platform-mock",
          packageVersion: "1.0.0",
          apiVersion: 2,
        },
        stableEnvKinds,
        createContext: ({ env, image }) => ({ env, image }),
        validators: [{
          id: "representative.borrow-probe",
          validate(world) {
            if (world.requestedEnv.kind !== "preview") return [];
            const candidate = world.components["service-a"];
            const unchanged = world.components["service-b"];
            const correct =
              candidate?.disposition.kind === "materialized" &&
              candidate.effectiveEnv.kind === "preview" &&
              unchanged?.disposition.kind === "borrowed" &&
              unchanged.disposition.from === "dev" &&
              unchanged.effectiveEnv.kind === "dev";
            return correct ? [] : [{
              code: "representative.borrow-invalid",
              message: "representative preview did not honor candidate/borrow semantics",
              component: "service-a",
            }];
          },
        }],
      });
      export const defineComponent = platform.defineComponent;
      export { h };
    `,
  );

  const componentDirs: Record<string, string> = {};
  for (const [name, borrowTarget] of [
    ["service-a", "prod"],
    ["service-b", "dev"],
  ] as const) {
    const componentDir = path.join(root, name);
    componentDirs[name] = componentDir;
    await mkdir(path.join(componentDir, "src"), { recursive: true });
    await writeFile(
      path.join(componentDir, "package.json"),
      `${JSON.stringify({
        name: `@henosis/${name}`,
        version: "0.0.0",
        type: "module",
        exports: { ".": "./src/index.ts" },
        henosis: { component: name },
        dependencies: { "@henosis/platform-mock": "*" },
      }, null, 2)}\n`,
    );
    await writeFile(
      path.join(componentDir, "src", "index.ts"),
      `
        import { defineComponent, h } from "@henosis/platform-mock";
        export default defineComponent({
          outputs: h.object({ environment: h.string() }),
          borrowForPreview: "${borrowTarget}",
          build: (ctx) => ({
            environment: ctx.env.kind === "preview" ? ctx.env.id : ctx.env.kind,
          }),
        });
      `,
    );
  }

  const candidate = `
    [environment]
    id = "dev"

    [components.service-a]
    repo = "henosis-playground/service-a"
    ref = "service-a-candidate"
    digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

    [components.service-b]
    repo = "henosis-playground/service-b"
    ref = "service-b-current"
    digest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  `;
  const dev = candidate.replace("service-a-candidate", "service-a-current");
  await writeFile(manifestPath, candidate);
  await writeFile(devManifestPath, dev);
  const platformRoot = platformRepoRoot();
  return {
    options: {
      manifestPath,
      devManifestPath,
      scratchDir,
      outputDir,
      localOverrides: {
        core: path.join(platformRoot, "packages", "core"),
        "platform-mock": platformDir,
        "service-a": componentDirs["service-a"] ?? "",
        "service-b": componentDirs["service-b"] ?? "",
        typescript: path.join(platformRoot, "node_modules", "typescript"),
      },
    },
  };
}

function platformRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}
