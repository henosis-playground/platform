import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  representativePreviewName,
  type RuntimeEnv,
} from "@henosis/core";
import {
  assembleWorkspace,
  checkWorkspaceTypes,
  readComponentDependencyGraph,
  resolveManifestComponents,
  type LocalOverrides,
  type ResolvedComponent,
} from "./assembler.js";
import { enrichGateFailures } from "./contract-diagnostics.js";
import {
  ExecutionPipelineError,
  executeComponents,
  inspectInstalledComponents,
  type ExecutionResult,
} from "./execute.js";
import {
  parseCompileFailures,
  pipelineFailures,
  renderFailure,
  type GateFailure,
  type GateReport,
} from "./gate-report.js";
import { isPinned, parseManifest, type EnvironmentManifest } from "./manifest.js";
import { currentPlatformRef, defaultPlatformRoot } from "./render.js";

/** Renderer/gate-runner options for one candidate cohort. */
export interface GateCliOptions {
  /** Candidate manifest path. */
  readonly manifestPath: string;
  /** Disposable workspace used for install/typecheck/execution. */
  readonly scratchDir: string;
  /** Directory receiving bot report files. */
  readonly outputDir: string;
  /** Current dev manifest path. */
  readonly devManifestPath: string;
  /** Local package overrides used by tests and live-world verification. */
  readonly localOverrides: LocalOverrides;
  /** Enables every non-dev cell; defaults to true. Dev is unconditional. */
  readonly widenedGate?: boolean;
  /** Explicit candidate-owned components; otherwise inferred from dev pin deltas. */
  readonly changedComponents?: readonly string[];
}

/** One environment result written to the non-bot `cells.json` sidecar. */
export interface GateCellReport {
  /** Canonical stable or representative-preview environment. */
  readonly environment: string;
  /** Whether the complete pipeline passed for this cell. */
  readonly ok: boolean;
  /** Existing bot-compatible failures scoped to this environment. */
  readonly failures: readonly GateFailure[];
}

/** Complete gate return value; `report` retains the strict Rust contract. */
export interface GateRunResult {
  /** Strict `{ok, failures}` report parsed by the Rust bot. */
  readonly report: GateReport;
  /** Per-environment sidecar results. */
  readonly cells: readonly GateCellReport[];
  /** Human-readable aggregate. */
  readonly text: string;
}

/** Runs tsc once, then the complete pipeline in every enabled blocking cell. */
export async function runGate(opts: GateCliOptions): Promise<GateRunResult> {
  const manifest = parseManifest(await readFile(opts.manifestPath, "utf8"));
  const devManifest = parseManifest(await readFile(opts.devManifestPath, "utf8"));
  const platformRoot = defaultPlatformRoot();
  const platformRef = currentPlatformRef(platformRoot);
  const components = resolveManifestComponents({ manifest, devManifest });
  const assembly = await assembleWorkspace({
    manifest,
    devManifest,
    scratchDir: opts.scratchDir,
    platformRef,
    localOverrides: opts.localOverrides,
  });
  if (!assembly.ok) {
    return compileFailureResult(
      assembly.compileOutput ?? "Workspace assembly failed",
      manifest,
      components,
      opts,
      platformRef,
    );
  }

  const typeCheck = await checkWorkspaceTypes({ scratchDir: opts.scratchDir });
  if (!typeCheck.ok) {
    return compileFailureResult(
      typeCheck.compileOutput ?? "Workspace typecheck failed",
      manifest,
      components,
      opts,
      platformRef,
    );
  }

  let stableKinds: readonly string[];
  try {
    stableKinds = (
      await inspectInstalledComponents({
        components,
        scratchDir: opts.scratchDir,
      })
    ).stableEnvKinds;
  } catch (error) {
    const failure =
      error instanceof ExecutionPipelineError
        ? pipelineFailures(error.failure, manifest.environment)
        : [renderFailure(errorMessage(error))];
    return failedCellsResult(
      [{ environment: environmentName(manifest.environment), ok: false, failures: failure }],
    );
  }
  if (!stableKinds.includes("dev")) {
    return failedCellsResult([
      {
        environment: "dev",
        ok: false,
        failures: [renderFailure('The merge gate requires a stable "dev" environment')],
      },
    ]);
  }

  const widenedGate = opts.widenedGate ?? true;
  const environments: RuntimeEnv[] = widenedGate
    ? [
        ...stableKinds.map((kind) => ({ kind })),
        { kind: "preview", id: representativePreviewName },
      ]
    : [{ kind: "dev" }];
  const changed =
    opts.changedComponents ?? inferChangedComponents(manifest, devManifest);
  const cells: GateCellReport[] = [];

  for (const environment of environments) {
    try {
      const execution = await executeComponents({
        manifest,
        devManifest,
        scratchDir: opts.scratchDir,
        platformRoot,
        localOverrides: opts.localOverrides,
        requestedEnv: environment,
        changedComponents:
          environment.kind === "preview"
            ? changed
            : components.map((component) => component.name),
      });
      cells.push(successCell(environment, execution));
    } catch (error) {
      const rawFailures =
        error instanceof ExecutionPipelineError
          ? pipelineFailures(error.failure, environment)
          : [renderFailure(`[${environmentName(environment)}] ${errorMessage(error)}`)];
      const failures = await enrichGateFailures(rawFailures, {
        scratchDir: opts.scratchDir,
        components,
        platformRef,
        localOverrides: opts.localOverrides,
      });
      cells.push({
        environment: environmentName(environment),
        ok: false,
        failures,
      });
    }
  }
  return resultFromCells(cells);
}

async function compileFailureResult(
  compileOutput: string,
  manifest: EnvironmentManifest,
  components: readonly ResolvedComponent[],
  opts: GateCliOptions,
  platformRef: string,
): Promise<GateRunResult> {
  const componentNames = components.map((component) => component.name);
  let graph = Object.fromEntries(
    componentNames.map((component) => [component, [] as string[]]),
  );
  try {
    graph = await readComponentDependencyGraph(opts.scratchDir, componentNames);
  } catch {
    // Installation may have failed before package manifests existed.
  }
  const failures = await enrichGateFailures(
    parseCompileFailures(compileOutput, graph),
    {
      scratchDir: opts.scratchDir,
      components,
      platformRef,
      localOverrides: opts.localOverrides,
    },
  );
  const environment = environmentName(manifest.environment);
  return {
    report: { ok: false, failures },
    cells: [{ environment, ok: false, failures }],
    text: formatMatrixText(
      [{ environment, ok: false, failures }],
      compileOutput,
    ),
  };
}

function successCell(
  environment: RuntimeEnv,
  execution: ExecutionResult,
): GateCellReport {
  void execution;
  return {
    environment: environmentName(environment),
    ok: true,
    failures: [],
  };
}

function failedCellsResult(cells: readonly GateCellReport[]): GateRunResult {
  return resultFromCells(cells);
}

function resultFromCells(cells: readonly GateCellReport[]): GateRunResult {
  const failures = cells.flatMap((cell) => cell.failures);
  const report: GateReport = { ok: failures.length === 0, failures };
  return {
    report,
    cells,
    text: formatMatrixText(cells),
  };
}

function inferChangedComponents(
  candidate: EnvironmentManifest,
  dev: EnvironmentManifest,
): string[] {
  return Object.entries(candidate.components)
    .filter(([, entry]) => isPinned(entry))
    .filter(([name, entry]) => {
      if (!isPinned(entry)) return false;
      const current = dev.components[name];
      return (
        current === undefined ||
        !isPinned(current) ||
        current.ref !== entry.ref ||
        current.digest !== entry.digest
      );
    })
    .map(([name]) => name)
    .sort(compareCodeUnits);
}

function formatMatrixText(
  cells: readonly GateCellReport[],
  compileOutput?: string,
): string {
  const ok = cells.every((cell) => cell.ok);
  const lines = [
    `Henosis gate: ${ok ? "PASS" : "FAIL"}`,
    "Blocking cells:",
    ...cells.map(
      (cell) =>
        `  ${cell.environment}: ${cell.ok ? "PASS" : `FAIL (${cell.failures.length})`}`,
    ),
  ];
  for (const cell of cells) {
    for (const failure of cell.failures) {
      lines.push("", `${cell.environment}: ${failure.message}`, failure.excerpt);
    }
  }
  if (compileOutput !== undefined && compileOutput.trim().length > 0) {
    lines.push("", "TypeScript errors:", compileOutput.trim());
  }
  return `${lines.join("\n")}\n`;
}

function environmentName(environment: RuntimeEnv): string {
  return environment.kind === "preview" && "id" in environment
    ? environment.id
    : environment.kind;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outputDir, { recursive: true });
  const { report, cells, text } = await runGate(options);
  await writeFile(
    path.join(options.outputDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(
    path.join(options.outputDir, "cells.json"),
    `${JSON.stringify(cells, null, 2)}\n`,
  );
  await writeFile(path.join(options.outputDir, "report.txt"), text);
  process.stdout.write(text);
  process.exitCode = report.ok ? 0 : 1;
}

function parseArgs(args: readonly string[]): GateCliOptions {
  const manifestPath = args[0];
  if (manifestPath === undefined || args.includes("--help")) {
    throw new Error(
      "Usage: henosis-gate <candidate.toml> --scratch <dir> [--output <dir>] [--dev-lockfile <dev.toml>] [--dev-only] [--local-override name=/path]",
    );
  }
  const scratchDir = requiredOption(args, "--scratch");
  const outputDir = optionValue(args, "--output") ?? process.cwd();
  const devManifestPath =
    optionValue(args, "--dev-lockfile") ??
    path.join(path.dirname(manifestPath), "dev.toml");
  const configuredWidened = process.env.HENOSIS_WIDENED_GATE;
  const widenedGate = args.includes("--dev-only")
    ? false
    : configuredWidened === undefined
      ? true
      : configuredWidened !== "false" && configuredWidened !== "0";
  return {
    manifestPath,
    scratchDir,
    outputDir,
    devManifestPath,
    localOverrides: parseLocalOverrides(args),
    widenedGate,
  };
}

function parseLocalOverrides(args: readonly string[]): LocalOverrides {
  const overrides: LocalOverrides = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--local-override") continue;
    const value = args[index + 1];
    if (value === undefined) throw new Error("--local-override requires name=/path");
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
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
