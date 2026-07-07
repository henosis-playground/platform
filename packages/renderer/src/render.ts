import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResourceRecord } from "@henosis/sdk";
import { assembleAndCheck, type LocalOverrides } from "./assembler.js";
import {
  executeComponents,
  type ExecutionComponent,
  type ExecutionResult,
  type MaterialisedBinding,
} from "./execute.js";
import { isPinned, parseLockfile, type Lockfile } from "./lockfile.js";

export type RenderManifest = {
  envId: string;
  generatedAt: string;
  components: Record<string, RenderManifestComponent>;
};

export type RenderManifestComponent =
  | {
      disposition: "render";
      ref: string;
      digest: string;
      namespace: string;
      binding: MaterialisedBinding;
      resources: ResourceRecord[];
    }
  | {
      disposition: "follow";
      followsEnvId: "dev";
      binding: MaterialisedBinding;
    };

export type RenderOutput = {
  manifestPath: string;
  componentFiles: Record<string, string>;
  manifest: RenderManifest;
};

export async function renderLockfile(opts: {
  lockfile: Lockfile;
  devLockfile: Lockfile;
  scratchDir: string;
  outputDir: string;
  platformRef: string;
  platformRoot: string;
  localOverrides?: LocalOverrides;
}): Promise<RenderOutput> {
  const assembly = await assembleAndCheck({
    lockfile: opts.lockfile,
    devLockfile: opts.devLockfile,
    scratchDir: opts.scratchDir,
    platformRef: opts.platformRef,
    localOverrides: opts.localOverrides,
  });

  if (!assembly.ok) {
    throw new Error(assembly.compileOutput ?? "Workspace assembly failed");
  }

  const execution = await executeComponents({
    lockfile: opts.lockfile,
    devLockfile: opts.devLockfile,
    scratchDir: opts.scratchDir,
    platformRoot: opts.platformRoot,
    localOverrides: opts.localOverrides,
  });

  return writeRenderOutput({
    execution,
    outputDir: opts.outputDir,
  });
}

export async function writeRenderOutput(opts: {
  execution: ExecutionResult;
  outputDir: string;
  generatedAt?: string;
}): Promise<RenderOutput> {
  await mkdir(opts.outputDir, { recursive: true });
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const manifest: RenderManifest = {
    envId: opts.execution.envId,
    generatedAt,
    components: Object.fromEntries(
      Object.entries(opts.execution.components).map(([name, component]) => [
        name,
        manifestComponent(component),
      ]),
    ),
  };

  const componentFiles: Record<string, string> = {};
  for (const [name, component] of Object.entries(opts.execution.components)) {
    const filePath = path.join(opts.outputDir, `${opts.execution.envId}-${name}.txt`);
    await writeFile(
      filePath,
      formatComponentRenderFile(opts.execution.envId, name, component),
    );
    componentFiles[name] = filePath;
  }

  const manifestPath = path.join(opts.outputDir, `${opts.execution.envId}-manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { manifestPath, componentFiles, manifest };
}

export function formatComponentRenderFile(
  envId: string,
  componentName: string,
  component: ExecutionComponent,
): string {
  if (component.disposition === "follow") {
    return [
      `Henosis render: ${componentName}`,
      "Disposition: follow dev (not deployed in this environment)",
      "Binding:",
      ...formatBinding(component.binding).map((line) => `  ${line}`),
      "",
    ].join("\n");
  }

  return [
    `Henosis render: ${componentName}`,
    `Environment: ${envId} (namespace: ${component.namespace})`,
    `Image: ${component.ref}@${component.digest}`,
    "Binding:",
    ...formatBinding(component.binding).map((line) => `  ${line}`),
    "Resources:",
    ...component.resources.flatMap((resource) =>
      formatResource(resource).map((line) => `  ${line}`),
    ),
    "",
  ].join("\n");
}

export function formatBinding(binding: MaterialisedBinding): string[] {
  return flattenBinding(binding).map(([key, value]) => `${key}=${String(value)}`);
}

export function formatResource(resource: ResourceRecord): string[] {
  switch (resource.kind) {
    case "service":
      return [
        `service on port ${resource.port}`,
        ...Object.entries(resource.env).map(([key, value]) => `  ${key}=${value}`),
      ];
    case "postgres":
      return [
        `postgres '${resource.name}'`,
        `  url=${resource.url}`,
        `  previews: ${resource.previews}`,
      ];
  }
}

export function defaultPlatformRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}

export function currentPlatformRef(platformRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: platformRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function manifestComponent(component: ExecutionComponent): RenderManifestComponent {
  if (component.disposition === "follow") {
    return {
      disposition: "follow",
      followsEnvId: "dev",
      binding: component.binding,
    };
  }

  return {
    disposition: "render",
    ref: component.ref,
    digest: component.digest,
    namespace: component.namespace,
    binding: component.binding,
    resources: component.resources,
  };
}

function flattenBinding(
  binding: MaterialisedBinding,
  prefix = "",
): Array<[string, string | number | boolean]> {
  if (
    typeof binding === "string" ||
    typeof binding === "number" ||
    typeof binding === "boolean"
  ) {
    return [[prefix, binding]];
  }

  return Object.entries(binding).flatMap(([key, value]) =>
    flattenBinding(value, prefix.length === 0 ? key : `${prefix}.${key}`),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const lockfilePath = args[0];
  if (lockfilePath === undefined || args.includes("--help")) {
    console.error("Usage: henosis-render <lockfile.toml> [--output-dir <dir>]");
    process.exitCode = 1;
    return;
  }

  const outputDir = optionValue(args, "--output-dir") ?? "rendered-output";
  const lockfile = parseLockfile(await readFile(lockfilePath, "utf8"));
  const devLockfilePath = path.join(path.dirname(lockfilePath), "dev.toml");
  const devLockfile = parseLockfile(await readFile(devLockfilePath, "utf8"));
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "henosis-render-"));
  const platformRoot = defaultPlatformRoot();
  const platformRef = currentPlatformRef(platformRoot);

  const output = await renderLockfile({
    lockfile,
    devLockfile,
    scratchDir,
    outputDir,
    platformRef,
    platformRoot,
  });

  const renderedNames = Object.keys(output.componentFiles).join(", ");
  const renderedPins = Object.entries(lockfile.components)
    .flatMap(([name, entry]) =>
      isPinned(entry) ? [`${name}@${entry.ref.slice(0, 7)}`] : [],
    )
    .join(", ");
  console.log(
    `Rendered ${lockfile.environment.id} (${renderedNames}) to ${outputDir}`,
  );
  if (renderedPins.length > 0) {
    console.log(`Rendered pins: ${renderedPins}`);
  }
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
