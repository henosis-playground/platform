import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runGate } from "../src/gate.js";

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
      message: "replicas.min must not exceed replicas.max (environment: prod)",
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
