import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionPipelineError, executeComponents } from "../src/execute.js";
import { parseManifest } from "../src/manifest.js";
import { writeRenderOutput } from "../src/render.js";

const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirs.splice(0).map((scratchDir) =>
      rm(scratchDir, { recursive: true, force: true }),
    ),
  );
});

describe("executeComponents", () => {
  it("uses follow only for pin resolution and renders every preview component", async () => {
    const scratchDir = await makeScratchWorkspace();
    const platformRoot = platformRepoRoot();

    await writeComponent(
      scratchDir,
      "service-a",
      {
        "@henosis/platform-mock": "*",
      },
      `
        import { defineComponent, envName, h } from "@henosis/platform-mock";

        export default defineComponent({
          outputs: h.object({ api: h.url() }),
          build: (_ctx, env) => ({
            api: \`https://service-a-\${envName(env)}.henosis.example\`,
          }),
        });
      `,
    );

    await writeComponent(
      scratchDir,
      "service-b",
      {
        "@henosis/platform-mock": "*",
        "@henosis/service-a": "*",
      },
      `
        import { defineComponent, envName, h } from "@henosis/platform-mock";
        import serviceA from "@henosis/service-a";

        export default defineComponent({
          outputs: h.object({
            app: h.url(),
            upstream: h.url(),
          }),
          build: (_ctx, env) => ({
            app: \`https://service-b-\${envName(env)}.henosis.example\`,
            upstream: serviceA.api,
          }),
        });
      `,
    );

    const manifest = parseManifest(`
      [environment]
      id = "preview-test"

      [components.service-b]
      repo = "henosis-playground/service-b"
      ref = "feature-service-b"
      digest = "sha256:service-b-preview"

      [components.service-a]
      follow = "dev"
    `);

    const devManifest = parseManifest(`
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
    `);

    const result = await executeComponents({
      manifest,
      devManifest,
      scratchDir,
      platformRoot,
    });

    expect(result.components["service-a"]).toEqual({
      disposition: "follow",
      follows: { kind: "dev" },
      env: { kind: "preview", id: "preview-test" },
      ref: "service-a-dev",
      digest: "sha256:service-a-dev",
      fellThrough: false,
      outputs: {
        api: "https://service-a-preview-test.henosis.example",
      },
      records: [],
      artifacts: [],
    });

    expect(result.components["service-b"]).toEqual({
      disposition: "pinned",
      env: { kind: "preview", id: "preview-test" },
      ref: "feature-service-b",
      digest: "sha256:service-b-preview",
      fellThrough: false,
      outputs: {
        app: "https://service-b-preview-test.henosis.example",
        upstream: "https://service-a-preview-test.henosis.example",
      },
      records: [],
      artifacts: [],
    });

    const outputDir = await mkdtemp(path.join(os.tmpdir(), "henosis-render-"));
    scratchDirs.push(outputDir);
    const render = await writeRenderOutput({
      execution: result,
      outputDir,
      generatedAt: "2026-07-08T00:00:00.000Z",
    });

    expect(Object.keys(render.componentFiles)).toEqual(["service-b", "service-a"]);
    expect(render.manifest.components).toEqual({
      "service-b": {
        ref: "feature-service-b",
        digest: "sha256:service-b-preview",
        outputs: {
          app: "https://service-b-preview-test.henosis.example",
          upstream: "https://service-a-preview-test.henosis.example",
        },
        records: [],
        artifacts: [],
      },
      "service-a": {
        ref: "service-a-dev",
        digest: "sha256:service-a-dev",
        outputs: {
          api: "https://service-a-preview-test.henosis.example",
        },
        records: [],
        artifacts: [],
      },
    });
  });

  it("honors fallThrough only outside the changed reverse-dependency closure", async () => {
    const scratchDir = await makeScratchWorkspace();
    const platformRoot = platformRepoRoot();
    await writeTestPlatform(scratchDir);

    await writeComponent(
      scratchDir,
      "service-a",
      { "@henosis/test-platform": "*" },
      componentSource("service-a", [], true),
    );
    await writeComponent(
      scratchDir,
      "service-b",
      {
        "@henosis/test-platform": "*",
        "@henosis/service-a": "*",
      },
      componentSource("service-b", ["service-a"], true),
    );
    await writeComponent(
      scratchDir,
      "service-c",
      {
        "@henosis/test-platform": "*",
        "@henosis/service-b": "*",
      },
      componentSource("service-c", ["service-b"], true),
    );
    await writeComponent(
      scratchDir,
      "service-d",
      { "@henosis/test-platform": "*" },
      componentSource("service-d", [], true),
    );

    const previewManifest = parseManifest(`
      [environment]
      id = "preview-closure"

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
    const devManifest = parseManifest(`
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

    const preview = await executeComponents({
      manifest: previewManifest,
      devManifest,
      scratchDir,
      platformRoot,
    });
    const dev = await executeComponents({
      manifest: devManifest,
      devManifest,
      scratchDir,
      platformRoot,
    });

    expect(preview.components["service-a"]).toMatchObject({
      env: { kind: "preview", id: "preview-closure" },
      fellThrough: false,
      outputs: { endpoint: "https://service-a-preview-closure.example" },
    });
    expect(preview.components["service-b"]).toMatchObject({
      env: { kind: "preview", id: "preview-closure" },
      fellThrough: false,
      outputs: {
        endpoint: "https://service-b-preview-closure.example",
        dependency: "https://service-a-preview-closure.example",
      },
    });
    expect(preview.components["service-c"]).toMatchObject({
      env: { kind: "preview", id: "preview-closure" },
      fellThrough: false,
      outputs: {
        endpoint: "https://service-c-preview-closure.example",
        dependency: "https://service-b-preview-closure.example",
      },
    });

    const fallenThrough = preview.components["service-d"];
    expect(fallenThrough).toMatchObject({
      env: { kind: "dev" },
      fellThrough: true,
      outputs: { endpoint: "https://service-d-dev.example" },
      artifacts: [],
    });
    expect(JSON.stringify(fallenThrough?.outputs)).toBe(
      JSON.stringify(dev.components["service-d"]?.outputs),
    );
    expect(dev.components["service-d"]?.artifacts).toEqual([
      { path: "environment.txt", contents: "dev" },
    ]);
    expect(dev.components["service-d"]?.fellThrough).toBe(false);
  });

  it("threads platform records and artifacts through worker and render output", async () => {
    const scratchDir = await makeScratchWorkspace();
    const platformRoot = platformRepoRoot();
    await writeTestPlatform(scratchDir);
    await writeComponent(
      scratchDir,
      "service-a",
      { "@henosis/test-platform": "*" },
      componentSource("service-a", [], false),
    );
    const manifest = parseManifest(`
      [environment]
      id = "dev"

      [components.service-a]
      repo = "henosis-playground/service-a"
      ref = "service-a-dev"
      digest = "sha256:service-a-dev"
    `);
    const execution = await executeComponents({
      manifest,
      devManifest: manifest,
      scratchDir,
      platformRoot,
    });

    expect(execution.components["service-a"]).toMatchObject({
      records: [
        { kind: "test-object", data: { environment: "dev" } },
      ],
      artifacts: [{ path: "environment.txt", contents: "dev" }],
    });

    const outputDir = await mkdtemp(path.join(os.tmpdir(), "henosis-render-"));
    scratchDirs.push(outputDir);
    const render = await writeRenderOutput({
      execution,
      outputDir,
      generatedAt: "2026-07-09T00:00:00.000Z",
    });
    expect(render.manifest.components["service-a"]).toMatchObject({
      records: [
        { kind: "test-object", data: { environment: "dev" } },
      ],
      artifacts: [{ path: "environment.txt", contents: "dev" }],
    });
  });

  it("invokes the platform world-validator hook through core", async () => {
    const scratchDir = await makeScratchWorkspace();
    const platformRoot = platformRepoRoot();
    await writeTestPlatform(scratchDir, true);
    await writeComponent(
      scratchDir,
      "service-a",
      { "@henosis/test-platform": "*" },
      componentSource("service-a", [], false),
    );
    const manifest = parseManifest(`
      [environment]
      id = "dev"

      [components.service-a]
      repo = "henosis-playground/service-a"
      ref = "service-a-dev"
      digest = "sha256:service-a-dev"
    `);

    await expect(
      executeComponents({
        manifest,
        devManifest: manifest,
        scratchDir,
        platformRoot,
      }),
    ).rejects.toMatchObject({
      failure: {
        component: "world",
        kind: "validate",
        message: "World validation failed: reserved hook ran",
      },
    });
  });

  it("reports validation failures with component, output path, expected, and actual", async () => {
    const scratchDir = await makeScratchWorkspace();
    const platformRoot = platformRepoRoot();

    await writeComponent(
      scratchDir,
      "service-a",
      {
        "@henosis/platform-mock": "*",
      },
      `
        import { defineComponent, h } from "@henosis/platform-mock";

        export default defineComponent({
          outputs: h.object({ api: h.url() }),
          build: () => ({ api: "not a url" }),
        });
      `,
    );

    const manifest = parseManifest(`
      [environment]
      id = "dev"

      [components.service-a]
      repo = "henosis-playground/service-a"
      ref = "service-a-dev"
      digest = "sha256:service-a-dev"
    `);

    await expect(
      executeComponents({
        manifest,
        devManifest: manifest,
        scratchDir,
        platformRoot,
      }),
    ).rejects.toMatchObject({
      failure: {
        component: "service-a",
        kind: "validate",
        message: "service-a.api expected url, got string",
      },
    });
  });

  it("reports refs whose source component is absent from the manifest", async () => {
    const scratchDir = await makeScratchWorkspace();
    const platformRoot = platformRepoRoot();

    await writeComponent(
      scratchDir,
      "service-a",
      {
        "@henosis/platform-mock": "*",
      },
      `
        import { defineComponent, envName, h } from "@henosis/platform-mock";

        export default defineComponent({
          outputs: h.object({ api: h.url() }),
          build: (_ctx, env) => ({
            api: \`https://service-a-\${envName(env)}.henosis.example\`,
          }),
        });
      `,
    );

    await writeComponent(
      scratchDir,
      "service-b",
      {
        "@henosis/platform-mock": "*",
        "@henosis/service-a": "*",
        "@henosis/toolkit": "*",
      },
      `
        import { defineComponent, envName, h } from "@henosis/platform-mock";
        import serviceA from "@henosis/service-a";

        export default defineComponent({
          outputs: h.object({
            app: h.url(),
            upstream: h.url(),
          }),
          build: (_ctx, env) => ({
            app: \`https://service-b-\${envName(env)}.henosis.example\`,
            upstream: serviceA.api,
          }),
        });
      `,
    );
    await writeNonComponentPackage(scratchDir, "toolkit");

    const manifest = parseManifest(`
      [environment]
      id = "preview-test"

      [components.service-b]
      repo = "henosis-playground/service-b"
      ref = "feature-service-b"
      digest = "sha256:service-b-preview"
    `);

    await expect(
      executeComponents({
        manifest,
        devManifest: manifest,
        scratchDir,
        platformRoot,
      }),
    ).rejects.toMatchObject({
      failure: {
        component: "service-b",
        consumerOf: "service-a",
        kind: "resolve",
        message: "service-b consumes service-a.api which no longer exists",
      },
    });
  });

  it("reports the consumed producer path when a surviving output changes type", async () => {
    const scratchDir = await makeScratchWorkspace();
    const platformRoot = platformRepoRoot();

    await writeComponent(
      scratchDir,
      "service-a",
      {
        "@henosis/platform-mock": "*",
      },
      `
        import { defineComponent, h } from "@henosis/platform-mock";

        export default defineComponent({
          outputs: h.object({ port: h.string() }),
          build: () => ({ port: "5432" }),
        });
      `,
    );

    await writeComponent(
      scratchDir,
      "service-b",
      {
        "@henosis/platform-mock": "*",
        "@henosis/service-a": "*",
      },
      `
        import { defineComponent, h } from "@henosis/platform-mock";
        import serviceA from "@henosis/service-a";

        export default defineComponent({
          outputs: h.object({ upstreamPort: h.number() }),
          build: () => ({ upstreamPort: serviceA.port }),
        });
      `,
    );

    const manifest = parseManifest(`
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
    `);

    await expect(
      executeComponents({
        manifest,
        devManifest: manifest,
        scratchDir,
        platformRoot,
      }),
    ).rejects.toMatchObject({
      failure: {
        component: "service-b",
        consumerOf: "service-a",
        consumedPaths: ["port"],
        kind: "validate",
        message: "service-b.upstreamPort expected number, got string",
      },
    });
  });
});

async function makeScratchWorkspace(): Promise<string> {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "henosis-execute-"));
  scratchDirs.push(scratchDir);

  const henosisModules = path.join(scratchDir, "node_modules", "@henosis");
  await mkdir(henosisModules, { recursive: true });

  const platformRoot = platformRepoRoot();
  await copyPackage(
    path.join(platformRoot, "packages", "core"),
    path.join(henosisModules, "core"),
  );
  await copyPackage(
    path.join(platformRoot, "packages", "platform-mock"),
    path.join(henosisModules, "platform-mock"),
  );

  return scratchDir;
}

async function copyPackage(source: string, target: string): Promise<void> {
  await cp(source, target, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(source, entry);
      return !relative.startsWith("node_modules");
    },
  });
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
    `${JSON.stringify(
      {
        name: `@henosis/${name}`,
        version: "0.0.0",
        private: true,
        type: "module",
        exports: { ".": "./src/index.ts" },
        henosis: { component: name },
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(packageDir, "src", "index.ts"), source);
}

async function writeNonComponentPackage(
  scratchDir: string,
  name: string,
): Promise<void> {
  const packageDir = path.join(scratchDir, "node_modules", "@henosis", name);
  await mkdir(path.join(packageDir, "src"), { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: `@henosis/${name}`,
        version: "0.0.0",
        type: "module",
        exports: { ".": "./src/index.ts" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(packageDir, "src", "index.ts"), "export {};\n");
}

async function writeTestPlatform(
  scratchDir: string,
  failValidation = false,
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
    `${JSON.stringify(
      {
        name: "@henosis/test-platform",
        version: "0.0.0",
        type: "module",
        exports: { ".": "./src/index.ts" },
        henosis: { platform: true },
        dependencies: { "@henosis/core": "*" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(packageDir, "src", "index.ts"),
    `
      import {
        definePlatform,
        envName,
        h,
        type BuildContext as CoreBuildContext,
        type Env as CoreEnv,
      } from "@henosis/core";

      const stableEnvKinds = ["dev", "staging", "prod"] as const;
      type StableEnvKind = (typeof stableEnvKinds)[number];
      type Env = CoreEnv<StableEnvKind>;
      type Context = CoreBuildContext<Env>;

      const platform = definePlatform<StableEnvKind, Context>({
        stableEnvKinds,
        validators: ${failValidation ? "[() => { throw new Error(\"reserved hook ran\"); }]" : "[]"},
        createContext: ({ env, image }) => ({ env, image }),
        finalize: (ctx, writers) => {
          writers.records.write({
            kind: "test-object",
            data: { environment: envName(ctx.env) },
          });
          writers.artifacts.write({
            path: "environment.txt",
            contents: envName(ctx.env),
          });
        },
      });

      export const defineComponent = platform.defineComponent;
      export { envName, h };
    `,
  );
}

function componentSource(
  name: string,
  dependencies: readonly string[],
  fallThrough: boolean,
): string {
  const imports = dependencies
    .map(
      (dependency, index) =>
        `import dependency${index} from "@henosis/${dependency}";`,
    )
    .join("\n");
  const dependencyOutput = dependencies.length === 0
    ? ""
    : ", dependency: dependency0.endpoint";
  return `
    import { defineComponent, envName, h } from "@henosis/test-platform";
    ${imports}

    export default defineComponent({
      outputs: h.object({
        endpoint: h.url()
        ${dependencies.length === 0 ? "" : ", dependency: h.url()"}
      }),
      fallThrough: ${String(fallThrough)},
      params: {
        dev: { prefix: "${name}" },
        staging: { prefix: "${name}" },
        prod: { prefix: "${name}" },
        preview: { prefix: "${name}" },
      },
      build: (ctx, params) => ({
        endpoint: \`https://\${params.prefix}-\${envName(ctx.env)}.example\`
        ${dependencyOutput}
      }),
    });
  `;
}

function platformRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}
