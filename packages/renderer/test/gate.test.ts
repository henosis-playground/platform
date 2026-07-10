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
      message: "[prod] replicas.min must not exceed replicas.max",
    });
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

function platformRepoRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}
