import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumedSchemaChange,
  enrichGateFailures,
  extractInstalledOutputSchema,
  producerShaFromPnpmLock,
} from "../src/contract-diagnostics.js";

const scratchDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    scratchDirs.splice(0).map((scratchDir) =>
      rm(scratchDir, { recursive: true, force: true }),
    ),
  );
});

describe("contract diagnostics", () => {
  it("parses the producer sha pinned by the consumer pnpm lockfile", () => {
    const lockfile = `
lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      '@henosis/service-a':
        specifier: github:henosis-playground/service-a#path:henosis
        version: https://codeload.github.com/henosis-playground/service-a/tar.gz/0123456789abcdef0123456789abcdef01234567#path:henosis
`;

    expect(producerShaFromPnpmLock(lockfile, "service-a")).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("extracts a sorted output schema from an installed component package", async () => {
    const scratchDir = await makeScratchWorkspace();
    await writeComponent(
      scratchDir,
      "service-a",
      `
        import { defineComponent, h } from "@henosis/platform-mock";

        export default defineComponent({
          outputs: h.object({
            port: h.number(),
            api: h.url(),
          }),
          build: () => ({
            api: "https://service-a.henosis.example",
            port: 5432,
          }),
        });
      `,
    );

    await expect(extractInstalledOutputSchema(scratchDir, "service-a")).resolves.toEqual({
      kind: "object",
      shape: {
        api: { kind: "url" },
        port: { kind: "number" },
      },
    });
  });

  it("detects removed and type-changed consumed schema paths", () => {
    const pinned = {
      kind: "object",
      shape: {
        api: { kind: "url" },
        port: { kind: "number" },
      },
    };
    const resolved = {
      kind: "object",
      shape: {
        apiUrl: { kind: "url" },
        port: { kind: "string" },
      },
    };

    expect(consumedSchemaChange(pinned, resolved, "api")).toBe("removed");
    expect(consumedSchemaChange(pinned, resolved, "port")).toBe("type-changed");
  });

  it("falls back to the consumer repo lockfile at the gated ref", async () => {
    const scratchDir = await makeScratchWorkspace();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`
lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      '@henosis/service-a':
        specifier: github:henosis-playground/service-a#path:henosis
        version: https://codeload.github.com/henosis-playground/service-a/tar.gz/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#path:henosis
`),
    );

    const [failure] = await enrichGateFailures(
      [
        {
          consumer: "service-b",
          producer: "service-a",
          pinnedSha: null,
          resolvedSha: null,
          outputsSchemaAtPinned: null,
          outputsSchemaAtResolved: null,
          consumedPaths: ["api"],
          kind: "compile",
          message: "service-b consumes service-a.api which no longer exists",
          excerpt: "Property 'api' does not exist on type",
        },
      ],
      {
        scratchDir,
        components: [
          {
            name: "service-b",
            packageName: "@henosis/service-b",
            repo: "henosis-playground/service-b",
            ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            digest: "sha256:service-b",
            disposition: "pinned",
            env: { kind: "dev" },
          },
        ],
        platformRef: "cccccccccccccccccccccccccccccccccccccccc",
        localOverrides: {},
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/henosis-playground/service-b/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/henosis/pnpm-lock.yaml",
    );
    expect(failure?.pinnedSha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("attributes an outside-world definition ref to the one absent component dependency", async () => {
    const scratchDir = await makeScratchWorkspace();
    await writeComponent(
      scratchDir,
      "service-a",
      `
        import { defineComponent, h } from "@henosis/platform-mock";
        export default defineComponent({
          outputs: h.object({ api: h.url() }),
          build: () => ({ api: "https://service-a.example" }),
        });
      `,
    );
    await writeComponent(
      scratchDir,
      "service-b",
      `
        import { defineComponent, h } from "@henosis/platform-mock";
        import serviceA from "@henosis/service-a";
        export default defineComponent({
          outputs: h.object({ upstream: h.url() }),
          build: () => ({ upstream: serviceA.api }),
        });
      `,
      { "@henosis/service-a": "*" },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));

    const [failure] = await enrichGateFailures(
      [
        {
          consumer: "service-b",
          producer: "unknown",
          pinnedSha: null,
          resolvedSha: null,
          outputsSchemaAtPinned: null,
          outputsSchemaAtResolved: null,
          consumedPaths: [],
          kind: "resolve",
          message: "service-b contains a ref to api from a component outside this world",
          excerpt: "service-b contains a ref to api from a component outside this world",
        },
      ],
      {
        scratchDir,
        components: [
          {
            name: "service-b",
            packageName: "@henosis/service-b",
            repo: "henosis-playground/service-b",
            ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            digest: "sha256:service-b",
            entry: { kind: "pinned" },
          },
        ],
        platformRef: "cccccccccccccccccccccccccccccccccccccccc",
        localOverrides: {},
      },
    );

    expect(failure).toMatchObject({
      consumer: "service-b",
      producer: "service-a",
      consumedPaths: ["api"],
    });
  });
});

async function makeScratchWorkspace(): Promise<string> {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "henosis-contract-"));
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
  source: string,
  dependencies: Record<string, string> = {},
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
        dependencies: {
          "@henosis/platform-mock": "*",
          ...dependencies,
        },
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
