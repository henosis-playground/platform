import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { executeComponents } from "../src/execute.js";
import { parseLockfile } from "../src/lockfile.js";

const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirs.splice(0).map((scratchDir) =>
      rm(scratchDir, { recursive: true, force: true }),
    ),
  );
});

describe("executeComponents", () => {
  it("materialises follow-dev producer bindings before the preview consumer build sees them", async () => {
    const scratchDir = await makeScratchWorkspace();
    const platformRoot = path.resolve(
      fileURLToPath(new URL("../../..", import.meta.url)),
    );

    const lockfile = parseLockfile(`
      [environment]
      id = "pr-test"

      [components.service-b]
      repo = "henosis-playground/service-b"
      ref = "feature-service-b"
      digest = "sha256:service-b-preview"

      [components.service-a]
      follow = "dev"
    `);

    const devLockfile = parseLockfile(`
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
      lockfile,
      devLockfile,
      scratchDir,
      platformRoot,
    });

    const serviceA = result.components["service-a"];
    expect(serviceA).toEqual({
      disposition: "follow",
      followsEnvId: "dev",
      binding: {
        api: "http://service-a.henosis-dev.svc.cluster.local:80",
        host: "service-a.henosis-dev.svc.cluster.local",
      },
    });

    const serviceB = result.components["service-b"];
    expect(serviceB?.disposition).toBe("render");
    if (serviceB?.disposition !== "render") {
      throw new Error("service-b was not rendered");
    }

    expect(serviceB.namespace).toBe("henosis-pr-test");
    expect(serviceB.binding).toEqual({
      app: "https://service-b-pr-test.henosis.example",
    });

    const serviceRecord = serviceB.resources.find(
      (resource) => resource.kind === "service",
    );
    expect(serviceRecord).toEqual({
      kind: "service",
      component: "service-b",
      image: { ref: "feature-service-b", digest: "sha256:service-b-preview" },
      port: 3000,
      env: {
        SERVICE_A_URL: "http://service-a.henosis-dev.svc.cluster.local:80",
        CLONE_DATABASE_URL:
          "postgres://henosis:henosis@service-b-clone-postgres.henosis-pr-test.svc.cluster.local:5432/clone",
        SHARED_DATABASE_URL:
          "postgres://henosis:henosis@service-b-shared-postgres.henosis-dev.svc.cluster.local:5432/shared",
      },
      namespace: "henosis-pr-test",
    });

    expect(
      serviceB.resources.filter((resource) => resource.component === "service-a"),
    ).toEqual([]);

    expect(
      serviceB.resources.find(
        (resource) => resource.kind === "postgres" && resource.name === "clone",
      ),
    ).toEqual({
      kind: "postgres",
      component: "service-b",
      name: "clone",
      previews: "clone",
      url: "postgres://henosis:henosis@service-b-clone-postgres.henosis-pr-test.svc.cluster.local:5432/clone",
      namespace: "henosis-pr-test",
    });

    expect(
      serviceB.resources.find(
        (resource) => resource.kind === "postgres" && resource.name === "shared",
      ),
    ).toEqual({
      kind: "postgres",
      component: "service-b",
      name: "shared",
      previews: "share-dev",
      url: "postgres://henosis:henosis@service-b-shared-postgres.henosis-dev.svc.cluster.local:5432/shared",
      namespace: "henosis-dev",
    });
  });
});

async function makeScratchWorkspace(): Promise<string> {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "henosis-execute-"));
  scratchDirs.push(scratchDir);

  const henosisModules = path.join(scratchDir, "node_modules", "@henosis");
  await mkdir(henosisModules, { recursive: true });

  const platformRoot = path.resolve(
    fileURLToPath(new URL("../../..", import.meta.url)),
  );
  const sdkSource = path.join(platformRoot, "packages", "sdk");
  await cp(sdkSource, path.join(henosisModules, "sdk"), {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(sdkSource, entry);
      return !relative.startsWith("dist") && !relative.startsWith("node_modules");
    },
  });

  await writeComponent(
    scratchDir,
    "service-a",
    {
      "@henosis/sdk": "*",
    },
    `
      import { defineComponent } from "@henosis/sdk";

      export default defineComponent("service-a", {
        binding: (b) => ({ api: b.httpUrl(), host: b.host() }),
        build: () => {
          throw new Error("service-a build should not execute for follow dev");
        },
      });
    `,
  );

  await writeComponent(
    scratchDir,
    "service-b",
    {
      "@henosis/sdk": "*",
      "@henosis/service-a": "*",
    },
    `
      import { defineComponent } from "@henosis/sdk";
      import serviceA from "@henosis/service-a";

      export default defineComponent("service-b", {
        binding: (b) => ({ app: b.publicUrl() }),
        build: (ctx) => {
          const a = ctx.use(serviceA);
          const cloned = ctx.postgres("clone", { previews: "clone" });
          const shared = ctx.postgres("shared", { previews: "share-dev" });

          ctx.service({
            image: ctx.image,
            port: 3000,
            env: {
              SERVICE_A_URL: a.api,
              CLONE_DATABASE_URL: cloned.url,
              SHARED_DATABASE_URL: shared.url,
            },
          });
        },
      });
    `,
  );

  return scratchDir;
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
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(packageDir, "src", "index.ts"), source);
}
