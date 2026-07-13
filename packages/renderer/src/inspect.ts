import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleWorkspace, resolveManifestComponents } from "./assembler.js";
import { extractInstalledOutputSchema } from "./contract-diagnostics.js";
import { parseManifest } from "./manifest.js";
import { currentPlatformRef, defaultPlatformRoot } from "./render.js";
import type { SchemaData } from "./schema-data.js";

/** Static output schemas keyed by component name. */
export type OutputSchemas = Readonly<Record<string, SchemaData>>;

/** Installs one fully resolved world and inspects its component defaults. */
export async function inspectOutputSchemas(
  manifestPath: string,
  scratchDir: string,
): Promise<OutputSchemas> {
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  const platformRoot = defaultPlatformRoot();
  const assembly = await assembleWorkspace({
    manifest,
    devManifest: manifest,
    stableManifests: {},
    scratchDir,
    platformRef: currentPlatformRef(platformRoot),
    localOverrides: {},
  });
  if (!assembly.ok) {
    throw new Error(assembly.compileOutput ?? "Output-schema workspace assembly failed");
  }

  const components = resolveManifestComponents({ manifest, stableManifests: {} });
  const schemas: Record<string, SchemaData> = {};
  for (const component of components) {
    const schema = await extractInstalledOutputSchema(scratchDir, component.name);
    if (schema === null) {
      throw new Error(`Component ${component.name} has no introspectable output schema`);
    }
    schemas[component.name] = schema;
  }
  return schemas;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const manifestPath = args[0];
  const outputPath = optionValue(args, "--output");
  if (manifestPath === undefined || outputPath === undefined || args.includes("--help")) {
    console.error("Usage: henosis-inspect <manifest.toml> --output <schemas.json>");
    process.exitCode = 1;
    return;
  }

  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "henosis-inspect-"));
  try {
    const schemas = await inspectOutputSchemas(manifestPath, scratchDir);
    await writeFile(outputPath, `${JSON.stringify(schemas)}\n`);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
