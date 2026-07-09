import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runGate } from "../src/gate.js";

const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirs.splice(0).map((scratchDir) =>
      rm(scratchDir, { recursive: true, force: true }),
    ),
  );
});

describe("runGate", () => {
  it("typechecks the platform-mock v2 ctx and inferred params row", async () => {
    const fixture = await makeGateFixture(`
      import { defineComponent, h, type Env } from "@henosis/platform-mock";

      export default defineComponent({
        outputs: h.object({ api: h.url() }),
        params: {
          dev: { origin: "dev.example" },
          staging: { origin: "staging.example" },
          prod: { origin: "prod.example" },
          preview: { origin: "preview.example" },
        },
        build: (ctx, params) => {
          const env: Env = ctx.env;
          const row: { origin: string } = params;
          void env;
          return { api: \`https://\${row.origin}\` };
        },
      });
    `);

    const { report } = await runGate(fixture.options);
    expect(report).toEqual({ ok: true, failures: [] });
  });

  it("validates component builds before workspace tsc", async () => {
    const fixture = await makeGateFixture(`
      import { defineComponent, h } from "@henosis/platform-mock";

      export default defineComponent({
        outputs: h.object({
          api: h.url(),
          test: h.string(),
        }),
        build: () => ({
          api: "https://service-a.henosis.example",
        }),
      });
    `);

    const { report, text } = await runGate(fixture.options);

    expect(report).toEqual({
      ok: false,
      failures: [
        {
          consumer: "service-a",
          producer: "service-a",
          pinnedSha: null,
          resolvedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          outputsSchemaAtPinned: null,
          outputsSchemaAtResolved: {
            kind: "object",
            shape: {
              api: { kind: "url" },
              test: { kind: "string" },
            },
          },
          consumedPaths: ["test"],
          kind: "validate",
          message: "service-a.test expected string, got missing",
          excerpt: "service-a.test expected string, got missing",
        },
      ],
    });
    expect(text).toContain("validate error:");
    expect(text).not.toContain("TypeScript errors:");
  });

  it("reports own output type mismatches as validate failures", async () => {
    const fixture = await makeGateFixture(`
      import { defineComponent, h } from "@henosis/platform-mock";

      export default defineComponent({
        outputs: h.object({ port: h.string() }),
        build: () => ({ port: 5432 }),
      });
    `);

    const { report } = await runGate(fixture.options);

    expect(report.failures[0]).toMatchObject({
      consumer: "service-a",
      producer: "service-a",
      consumedPaths: ["port"],
      kind: "validate",
      message: "service-a.port expected string, got number",
      outputsSchemaAtResolved: {
        kind: "object",
        shape: {
          port: { kind: "string" },
        },
      },
    });
  });
});

async function makeGateFixture(source: string): Promise<{
  options: Parameters<typeof runGate>[0];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "henosis-gate-test-"));
  scratchDirs.push(root);
  const scratchDir = path.join(root, "scratch");
  const outputDir = path.join(root, "output");
  const componentDir = path.join(root, "service-a");
  const manifestPath = path.join(root, "candidate.toml");
  const devManifestPath = path.join(root, "dev.toml");
  await mkdir(path.join(componentDir, "src"), { recursive: true });

  await writeFile(
    path.join(componentDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@henosis/service-a",
        version: "0.0.0",
        private: true,
        type: "module",
        exports: { ".": "./src/index.ts" },
        henosis: { component: "service-a" },
        dependencies: {
          "@henosis/platform-mock": "*",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(componentDir, "src", "index.ts"), source);

  const manifest = `
    [environment]
    id = "dev"

    [components.service-a]
    repo = "henosis-playground/service-a"
    ref = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    digest = "sha256:service-a"
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
        "platform-mock": path.join(platformRoot, "packages", "platform-mock"),
        "service-a": componentDir,
        typescript: path.join(platformRoot, "node_modules", "typescript"),
      },
    },
  };
}

function platformRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}
