import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleAndCheck,
  readComponentDependencyGraph,
  resolveManifestComponents,
  type LocalOverrides,
} from "./assembler.js";
import { executeComponents, ExecutionPipelineError } from "./execute.js";
import {
  formatGateText,
  parseCompileFailures,
  pipelineFailure,
  renderFailure,
  type GateReport,
} from "./gate-report.js";
import { parseManifest } from "./manifest.js";
import { currentPlatformRef, defaultPlatformRoot } from "./render.js";

type GateCliOptions = {
  manifestPath: string;
  scratchDir: string;
  outputDir: string;
  devManifestPath: string;
  localOverrides: LocalOverrides;
};

async function runGate(opts: GateCliOptions): Promise<{
  report: GateReport;
  text: string;
}> {
  const manifest = parseManifest(await readFile(opts.manifestPath, "utf8"));
  const devManifest = parseManifest(await readFile(opts.devManifestPath, "utf8"));
  const platformRoot = defaultPlatformRoot();
  const platformRef = currentPlatformRef(platformRoot);
  const components = resolveManifestComponents({ manifest, devManifest });

  const assembly = await assembleAndCheck({
    manifest,
    devManifest,
    scratchDir: opts.scratchDir,
    platformRef,
    localOverrides: opts.localOverrides,
  });

  if (!assembly.ok) {
    const componentNames = components.map((component) => component.name);
    let graph = Object.fromEntries(
      componentNames.map((component) => [component, [] as string[]]),
    );
    try {
      graph = await readComponentDependencyGraph(opts.scratchDir, componentNames);
    } catch {
      // Install may have failed before package manifests existed.
    }

    const compileOutput = assembly.compileOutput ?? "Workspace assembly failed";
    const failures = parseCompileFailures(compileOutput, graph);
    const report: GateReport = { ok: false, failures };
    return {
      report,
      text: formatGateText({
        ok: false,
        environment: manifest.environment,
        components,
        failures,
        compileOutput,
      }),
    };
  }

  try {
    const execution = await executeComponents({
      manifest,
      devManifest,
      scratchDir: opts.scratchDir,
      platformRoot,
      localOverrides: opts.localOverrides,
    });

    const report: GateReport = { ok: true, failures: [] };
    return {
      report,
      text: formatGateText({
        ok: true,
        environment: manifest.environment,
        components,
        execution,
        failures: [],
      }),
    };
  } catch (error) {
    const failure =
      error instanceof ExecutionPipelineError
        ? pipelineFailure(error.failure)
        : renderFailure(error instanceof Error ? error.message : String(error));
    const report: GateReport = { ok: false, failures: [failure] };
    return {
      report,
      text: formatGateText({
        ok: false,
        environment: manifest.environment,
        components,
        failures: [failure],
      }),
    };
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outputDir, { recursive: true });

  const { report, text } = await runGate(options);
  await writeFile(
    path.join(options.outputDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(path.join(options.outputDir, "report.txt"), text);
  process.stdout.write(text);
  process.exitCode = report.ok ? 0 : 1;
}

function parseArgs(args: readonly string[]): GateCliOptions {
  const manifestPath = args[0];
  if (manifestPath === undefined || args.includes("--help")) {
    throw new Error(
      "Usage: henosis-gate <candidate.toml> --scratch <scratch-dir> [--output <dir>] [--dev-lockfile <dev.toml>] [--local-override name=/path]",
    );
  }

  const scratchDir = requiredOption(args, "--scratch");
  const outputDir = optionValue(args, "--output") ?? process.cwd();
  const devManifestPath =
    optionValue(args, "--dev-lockfile") ?? path.join(path.dirname(manifestPath), "dev.toml");

  return {
    manifestPath,
    scratchDir,
    outputDir,
    devManifestPath,
    localOverrides: parseLocalOverrides(args),
  };
}

function parseLocalOverrides(args: readonly string[]): LocalOverrides {
  const overrides: LocalOverrides = {};

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--local-override") {
      continue;
    }

    const value = args[index + 1];
    if (value === undefined) {
      throw new Error("--local-override requires name=/path");
    }

    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error("--local-override requires name=/path");
    }

    overrides[value.slice(0, separator)] = value.slice(separator + 1);
  }

  return overrides;
}

function requiredOption(args: readonly string[], name: string): string {
  const value = optionValue(args, name);
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
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
