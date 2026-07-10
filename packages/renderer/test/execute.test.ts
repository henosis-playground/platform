import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { pipelineFailures } from "../src/gate-report.js";
import { ExecutionPipelineError, executeComponents } from "../src/execute.js";
import { parseManifest } from "../src/manifest.js";
import {
  atomicPublishDirectory,
  writeRenderOutput,
} from "../src/render.js";

const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("worker execution and render publication", () => {
  it("honors targeted borrowing and emits subscriptions for differing targets", async () => {
    const scratchDir = await makeScratchWorkspace();
    await writeTestPlatform(scratchDir);
    await writeComponent(
      scratchDir,
      "service-a",
      { "@henosis/test-platform": "*" },
      componentSource("service-a", undefined),
    );
    await writeComponent(
      scratchDir,
      "service-b",
      {
        "@henosis/test-platform": "*",
        "@henosis/service-a": "*",
      },
      componentSource("service-b", "service-a"),
    );
    await writeComponent(
      scratchDir,
      "service-c",
      { "@henosis/test-platform": "*" },
      componentSource("service-c", undefined),
    );
    await writeComponent(
      scratchDir,
      "service-d",
      { "@henosis/test-platform": "*" },
      componentSource("service-d", undefined, "dev"),
    );

    const preview = parseManifest(`
      [environment]
      id = "preview-borrow-test"

      [components.service-a]
      repo = "henosis-playground/service-a"
      ref = "service-a-change"
      digest = "sha256:service-a-change"

      [components.service-b]
      follow = "dev"

      [components.service-c]
      follow = "dev"

      [components.service-d]
      follow = "dev"
    `);
    const dev = parseManifest(`
      [environment]
      id = "dev"

      [components.service-a]
      repo = "henosis-playground/service-a"
      ref = "service-a-dev"
      digest = "sha256:service-a-dev"

      [components.service-b]
      repo = "henosis-playground/service-b"
      ref = "service-b-dev"
      digest = "sha256:service-b-dev"

      [components.service-c]
      repo = "henosis-playground/service-c"
      ref = "service-c-dev"
      digest = "sha256:service-c-dev"

      [components.service-d]
      repo = "henosis-playground/service-d"
      ref = "service-d-dev"
      digest = "sha256:service-d-dev"
    `);

    const result = await executeComponents({
      manifest: preview,
      devManifest: dev,
      scratchDir,
      platformRoot: platformRepoRoot(),
    });
    expect(result.components["service-a"]).toMatchObject({
      source: { kind: "pinned" },
      effectiveEnv: { kind: "preview", id: "preview-borrow-test" },
      disposition: { kind: "materialized" },
    });
    expect(result.components["service-b"]).toMatchObject({
      source: { kind: "follower", follow: "dev" },
      effectiveEnv: { kind: "preview", id: "preview-borrow-test" },
      disposition: { kind: "materialized" },
      records: [
        {
          kind: "build-ref",
          data: {
            value: "https://service-a-preview-borrow-test.example",
          },
        },
        {
          kind: "environment",
          data: { environment: "preview-borrow-test" },
        },
      ],
    });
    expect(result.components["service-c"]).toMatchObject({
      source: { kind: "follower", follow: "dev" },
      effectiveEnv: { kind: "prod" },
      disposition: {
        kind: "borrowed",
        from: "prod",
        effectiveEnv: { kind: "prod" },
      },
      outputs: { endpoint: "https://service-c-prod.example" },
      records: [],
      artifacts: [],
    });
    expect(result.components["service-d"]).toMatchObject({
      effectiveEnv: { kind: "dev" },
      disposition: {
        kind: "borrowed",
        from: "dev",
        effectiveEnv: { kind: "dev" },
      },
      outputs: { endpoint: "https://service-d-dev.example" },
      records: [],
      artifacts: [],
    });
    expect(result.subscriptions).toEqual(["dev", "prod"]);

    const borrowedOnly = await executeComponents({
      manifest: dev,
      devManifest: dev,
      scratchDir,
      platformRoot: platformRepoRoot(),
      requestedEnv: { kind: "preview", id: "preview-borrow-test" },
      changedComponents: ["service-a"],
    });
    expect(borrowedOnly.components["service-c"]?.disposition).toMatchObject({
      kind: "borrowed",
      from: "prod",
    });
    expect(borrowedOnly.components["service-d"]?.disposition).toMatchObject({
      kind: "borrowed",
      from: "dev",
    });
    expect(borrowedOnly.subscriptions).toEqual(["dev", "prod"]);

    const outputDir = await mkdtemp(path.join(os.tmpdir(), "henosis-output-parent-"));
    scratchDirs.push(outputDir);
    const finalDir = path.join(outputDir, "rendered");
    const output = await writeRenderOutput({
      execution: borrowedOnly,
      outputDir: finalDir,
    });
    expect(output.artifactFiles["service-c"]).toEqual([]);
    expect(output.artifactFiles["service-a"]).toHaveLength(1);
    expect(output.artifactFiles["service-c"]).toEqual([]);
    expect(output.artifactFiles["service-d"]).toEqual([]);
    const metadata = JSON.parse(await readFile(output.manifestPath, "utf8"));
    expect(metadata).not.toHaveProperty("generatedAt");
    expect(metadata.subscriptions).toEqual(["dev", "prod"]);
    expect(metadata.components["service-c"].artifactPaths).toEqual([]);
    expect(metadata.components["service-d"].artifactPaths).toEqual([]);
  });

  it("keeps the previous rendered world when the atomic pointer switch fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "henosis-publish-"));
    scratchDirs.push(root);
    const versions = path.join(root, ".rendered.versions");
    await mkdir(versions, { recursive: true });
    const outputDir = path.join(root, "rendered");
    const first = await mkdtemp(path.join(versions, "world-"));
    await writeFile(path.join(first, "marker.txt"), "previous\n");
    await atomicPublishDirectory(first, outputDir);

    const replacement = await mkdtemp(path.join(versions, "world-"));
    await writeFile(path.join(replacement, "marker.txt"), "replacement\n");
    await expect(
      atomicPublishDirectory(replacement, outputDir, async () => {
        throw new Error("injected pointer rename failure");
      }),
    ).rejects.toThrow("injected pointer rename failure");

    expect(await readFile(path.join(outputDir, "marker.txt"), "utf8")).toBe(
      "previous\n",
    );
  });

  it("preserves structured validator issues verbatim worker to gate failure", async () => {
    const scratchDir = await makeScratchWorkspace();
    await writeTestPlatform(scratchDir, true);
    await writeComponent(
      scratchDir,
      "service-a",
      { "@henosis/test-platform": "*" },
      componentSource("service-a", undefined),
    );
    const manifest = parseManifest(`
      [environment]
      id = "prod"

      [components.service-a]
      repo = "henosis-playground/service-a"
      ref = "service-a-prod"
      digest = "sha256:service-a-prod"
    `);

    let failure: ExecutionPipelineError["failure"] | undefined;
    try {
      await executeComponents({
        manifest,
        devManifest: manifest,
        scratchDir,
        platformRoot: platformRepoRoot(),
      });
    } catch (error) {
      if (error instanceof ExecutionPipelineError) failure = error.failure;
      else throw error;
    }
    expect(failure?.issues).toEqual([
      {
        code: "test.invalid-environment",
        message: "prod is forbidden by this test policy",
        component: "service-a",
        record: { index: 0, path: "/environment" },
        help: "choose another environment",
        validator: "test.policy",
        source: "platform",
      },
    ]);
    const [reported] = pipelineFailures(failure!, { kind: "prod" });
    expect(reported?.message).toBe("prod is forbidden by this test policy");
    expect(reported?.excerpt).toContain("Environment: prod");
    expect(reported?.excerpt).toContain("Pipeline stage: world-validation");
    expect(reported?.excerpt).toContain(JSON.stringify(failure?.issues?.[0]));
    expect(reported?.consumedPaths).toEqual(["/environment"]);
  });
});

async function makeScratchWorkspace(): Promise<string> {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "henosis-execute-"));
  scratchDirs.push(scratchDir);
  const modules = path.join(scratchDir, "node_modules", "@henosis");
  await mkdir(modules, { recursive: true });
  await cp(
    path.join(platformRepoRoot(), "packages", "core"),
    path.join(modules, "core"),
    {
      recursive: true,
      filter: (entry) => !path.relative(path.join(platformRepoRoot(), "packages", "core"), entry).startsWith("node_modules"),
    },
  );
  return scratchDir;
}

async function writeTestPlatform(
  scratchDir: string,
  validateProd = false,
): Promise<void> {
  const packageDir = path.join(
    scratchDir,
    "node_modules",
    "@henosis",
    "test-platform",
  );
  await mkdir(path.join(packageDir, "src"), { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({
      name: "@henosis/test-platform",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./src/index.ts" },
      henosis: { platform: true },
      dependencies: { "@henosis/core": "*" },
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(packageDir, "src", "index.ts"),
    `
      import {
        definePlatform,
        formatEnvironment,
        h,
        type BuildContext as CoreBuildContext,
        type Environment,
        type Ref,
      } from "@henosis/core";

      const stableEnvKinds = ["dev", "prod"] as const;
      type Env = Environment<(typeof stableEnvKinds)[number]>;
      type Context = CoreBuildContext<Env> & { record(value: Ref<string>): void };

      const platform = definePlatform<typeof stableEnvKinds, Context>({
        identity: {
          packageName: "@henosis/test-platform",
          packageVersion: "1.0.0",
          apiVersion: 2,
        },
        stableEnvKinds,
        createContext: ({ env, image, records }) => ({
          env,
          image,
          record: (value) => records.write({ kind: "build-ref", data: { value } }),
        }),
        finishRecords: (ctx, records) => records.write({
          kind: "environment",
          data: { environment: formatEnvironment(ctx.env) },
        }),
        project: ({ records }) => [{
          path: "records.json",
          contents: JSON.stringify(records),
        }],
        validators: ${validateProd ? `[{
          id: "test.policy",
          validate(world) {
            if (world.requestedEnv.kind !== "prod") return [];
            return [{
              code: "test.invalid-environment",
              message: "prod is forbidden by this test policy",
              component: "service-a",
              record: { index: 0, path: "/environment" },
              help: "choose another environment",
            }];
          },
        }]` : "[]"},
      });
      export const defineComponent = platform.defineComponent;
      export { h };
      export const envName = platform.formatEnvironment;
    `,
  );
}

async function writeComponent(
  scratchDir: string,
  name: string,
  dependencies: Record<string, string>,
  source: string,
): Promise<void> {
  const packageDir = path.join(scratchDir, "node_modules", "@henosis", name);
  await mkdir(path.join(packageDir, "src"), { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    `${JSON.stringify({
      name: `@henosis/${name}`,
      version: "0.0.0",
      type: "module",
      exports: { ".": "./src/index.ts" },
      henosis: { component: name },
      dependencies,
    }, null, 2)}\n`,
  );
  await writeFile(path.join(packageDir, "src", "index.ts"), source);
}

function componentSource(
  name: string,
  dependency: string | undefined,
  borrowTarget: "dev" | "prod" = "prod",
): string {
  const dependencyImport = dependency === undefined
    ? ""
    : `import dependency from "@henosis/${dependency}";`;
  const record = dependency === undefined ? "" : "ctx.record(dependency.endpoint);";
  const output = dependency === undefined
    ? `\`https://${name}-\${params.suffix}.example\``
    : "dependency.endpoint";
  return `
    import { defineComponent, h } from "@henosis/test-platform";
    ${dependencyImport}
    export default defineComponent({
      outputs: h.object({ endpoint: h.url() }),
      borrowForPreview: "${borrowTarget}",
      params: {
        dev: { suffix: "dev" },
        prod: { suffix: "prod" },
        preview: { suffix: "preview-borrow-test" },
      },
      build: (ctx, params) => {
        ${record}
        return { endpoint: ${output} };
      },
    });
  `;
}

function platformRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}
