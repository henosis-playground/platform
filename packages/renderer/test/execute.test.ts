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
  it("resolves follow-dev producer outputs for a pinned preview consumer without materialising the follower", async () => {
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
      id = "pr-test"

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
      env: { kind: "dev" },
      outputs: {
        api: "https://service-a-dev.henosis.example",
      },
      records: [],
      artifacts: [],
    });

    expect(result.components["service-b"]).toEqual({
      disposition: "pinned",
      env: { kind: "preview", id: "pr-test" },
      ref: "feature-service-b",
      digest: "sha256:service-b-preview",
      outputs: {
        app: "https://service-b-pr-test.henosis.example",
        upstream: "https://service-a-dev.henosis.example",
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

    expect(Object.keys(render.componentFiles)).toEqual(["service-b"]);
    expect(render.manifest.components).toEqual({
      "service-b": {
        ref: "feature-service-b",
        digest: "sha256:service-b-preview",
        outputs: {
          app: "https://service-b-pr-test.henosis.example",
          upstream: "https://service-a-dev.henosis.example",
        },
        records: [],
        artifacts: [],
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
      id = "pr-test"

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

function platformRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}
