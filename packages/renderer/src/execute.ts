import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ComponentArtifact,
  ComponentDisposition,
  ComponentPlatformInfo,
  Environment,
  JsonValue,
  PipelineFailure,
  RenderResult,
  ResolvedComponentRecord,
  RuntimeEnv,
} from "@henosis/core";
import {
  readComponentDependencyGraph,
  resolveManifestComponents,
  type LocalOverrides,
  type ResolvedComponent,
} from "./assembler.js";
import { isPinned, type EnvironmentManifest } from "./manifest.js";

/** Error thrown when a worker returns a structured core pipeline failure. */
export class ExecutionPipelineError extends Error {
  /** Creates an execution error preserving the complete structured failure. */
  constructor(readonly failure: PipelineFailure) {
    super(failure.message);
    this.name = "ExecutionPipelineError";
  }
}

/** One component returned across the renderer worker boundary. */
export interface ExecutionComponent {
  /** Source pin ref. */
  readonly ref: string;
  /** Immutable image digest. */
  readonly digest: string;
  /** Whether the source pin was direct or followed a stable manifest. */
  readonly source:
    | { readonly kind: "pinned" }
    | { readonly kind: "follower"; readonly follow: string };
  /** Effective environment selected by core. */
  readonly effectiveEnv: Environment<string>;
  /** Explicit materialized or borrowed disposition. */
  readonly disposition: ComponentDisposition<string>;
  /** Fully resolved outputs. */
  readonly outputs: JsonValue;
  /** Canonical deployment records; empty when borrowed. */
  readonly records: readonly ResolvedComponentRecord[];
  /** Projected files; empty when borrowed. */
  readonly artifacts: readonly ComponentArtifact[];
  /** Actual ref dependencies observed by core resolution. */
  readonly dependencies: readonly string[];
}

/** Complete execution result for one requested environment. */
export interface ExecutionResult {
  /** Requested environment. */
  readonly env: Environment<string>;
  /** Platform facts discovered from component defaults. */
  readonly platform: ComponentPlatformInfo;
  /** Stable environments whose pins can require this manifest to re-render. */
  readonly subscriptions: readonly string[];
  /** Component results keyed by manifest name. */
  readonly components: Readonly<Record<string, ExecutionComponent>>;
}

type WorkerInput = {
  mode: "inspect" | "execute";
  components: Record<string, { ref: string; digest: string; follow?: string }>;
  dependencies: Readonly<Record<string, readonly string[]>>;
  requestedEnv: RuntimeEnv;
  changed: readonly string[];
  scratchDir: string;
  outputPath: string;
};

type WorkerOutput =
  | {
      ok: true;
      platform: ComponentPlatformInfo;
      result?: RenderResult<string>;
    }
  | {
      ok: false;
      failure: PipelineFailure;
      platform?: ComponentPlatformInfo;
    };

/** Discovers platform identity and stable kinds from installed defaults only. */
export async function inspectInstalledComponents(opts: {
  /** Fully resolved candidate components. */
  readonly components: readonly ResolvedComponent[];
  /** Installed scratch workspace. */
  readonly scratchDir: string;
}): Promise<ComponentPlatformInfo> {
  const output = await runWorker({
    mode: "inspect",
    components: workerComponents(opts.components),
    dependencies: {},
    requestedEnv: { kind: "dev" },
    changed: [],
    scratchDir: opts.scratchDir,
  });
  if (!output.ok) throw new ExecutionPipelineError(output.failure);
  return output.platform;
}

/** Runs the core-owned pipeline in a fresh worker for one environment. */
export async function executeComponents(opts: {
  /** Requested manifest whose pins are rendered. */
  readonly manifest: EnvironmentManifest;
  /** Dev manifest retained for live follower compatibility. */
  readonly devManifest: EnvironmentManifest;
  /** Stable manifests available as generalized follower targets. */
  readonly stableManifests?: Readonly<Record<string, EnvironmentManifest>>;
  /** Installed scratch workspace. */
  readonly scratchDir: string;
  /** Repository root retained for CLI compatibility. */
  readonly platformRoot: string;
  /** Local overrides retained for CLI compatibility. */
  readonly localOverrides?: LocalOverrides;
  /** Gate cell environment override. */
  readonly requestedEnv?: RuntimeEnv;
  /** Gate candidate changed set override. */
  readonly changedComponents?: readonly string[];
}): Promise<ExecutionResult> {
  void opts.platformRoot;
  void opts.localOverrides;
  const resolved = resolveManifestComponents({
    manifest: opts.manifest,
    stableManifests: {
      dev: opts.devManifest,
      ...(opts.stableManifests ?? {}),
    },
  });
  const componentNames = resolved.map((component) => component.name);
  const dependencies = await readComponentDependencyGraph(
    opts.scratchDir,
    componentNames,
  );
  const requestedEnv = opts.requestedEnv ?? opts.manifest.environment;
  const changed =
    opts.changedComponents ??
    (opts.manifest.environment.kind === "preview"
      ? Object.entries(opts.manifest.components)
          .filter(([, entry]) => isPinned(entry))
          .map(([name]) => name)
      : componentNames);
  const output = await runWorker({
    mode: "execute",
    components: workerComponents(resolved),
    dependencies,
    requestedEnv,
    changed,
    scratchDir: opts.scratchDir,
  });
  if (!output.ok) throw new ExecutionPipelineError(output.failure);
  if (output.result === undefined) {
    throw new ExecutionPipelineError({
      stage: "build",
      message: "Execution worker omitted its render result",
    });
  }

  const components: Record<string, ExecutionComponent> = {};
  for (const component of resolved) {
    const result = output.result.components[component.name];
    if (result === undefined) {
      throw new ExecutionPipelineError({
        stage: "build",
        component: component.name,
        message: `Execution worker omitted ${component.name}`,
      });
    }
    components[component.name] = Object.freeze({
      ref: component.ref,
      digest: component.digest,
      source: component.entry,
      effectiveEnv: result.effectiveEnv,
      disposition: result.disposition,
      outputs: result.outputs,
      records: result.records,
      artifacts: result.artifacts,
      dependencies: result.dependencies,
    });
  }
  const subscriptions = new Set<string>();
  for (const component of Object.values(components)) {
    if (component.source.kind === "follower") {
      subscriptions.add(component.source.follow);
    }
    if (component.disposition.kind === "borrowed") {
      subscriptions.add(component.disposition.from);
    }
  }
  return Object.freeze({
    env: output.result.requestedEnv,
    platform: output.platform,
    subscriptions: Object.freeze([...subscriptions].sort(compareCodeUnits)),
    components: Object.freeze(components),
  });
}

function workerComponents(
  components: readonly ResolvedComponent[],
): Record<string, { ref: string; digest: string; follow?: string }> {
  return Object.fromEntries(
    components.map((component) => [
      component.name,
      {
        ref: component.ref,
        digest: component.digest,
        ...(component.entry.kind === "follower"
          ? { follow: component.entry.follow }
          : {}),
      },
    ]),
  );
}

async function runWorker(
  input: Omit<WorkerInput, "outputPath">,
): Promise<WorkerOutput> {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputPath = path.join(
    input.scratchDir,
    `.henosis-execute-${token}.input.json`,
  );
  const outputPath = path.join(
    input.scratchDir,
    `.henosis-execute-${token}.output.json`,
  );
  await writeFile(
    inputPath,
    `${JSON.stringify({ ...input, outputPath } satisfies WorkerInput)}\n`,
  );

  const builtWorkerPath = fileURLToPath(
    new URL("./execute-worker.js", import.meta.url),
  );
  const workerPath = existsSync(builtWorkerPath)
    ? builtWorkerPath
    : fileURLToPath(new URL("./execute-worker.ts", import.meta.url));
  const rendererPackageRoot = path.resolve(
    fileURLToPath(new URL("..", import.meta.url)),
  );
  try {
    await runCommand(process.execPath, ["--import", "tsx", workerPath, inputPath], {
      cwd: rendererPackageRoot,
    });
    return parseWorkerOutput(readFileSync(outputPath, "utf8"));
  } catch (error) {
    throw new ExecutionPipelineError({
      stage: "build",
      message: errorMessage(error),
    });
  } finally {
    removeIfPresent(inputPath);
    removeIfPresent(outputPath);
  }
}

async function runCommand(
  command: string,
  args: readonly string[],
  opts: { cwd: string },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const capture = commandCaptureFiles(opts.cwd);
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", capture.stdoutFd, capture.stderrFd],
    });
    child.on("error", (error) => {
      const output = readCommandCapture(capture);
      reject(new CommandError(error.message, output.stdout, output.stderr));
    });
    child.on("close", (code) => {
      const output = readCommandCapture(capture);
      if (code === 0) resolve();
      else {
        reject(
          new CommandError(
            `${command} exited with status ${code ?? "unknown"}`,
            output.stdout,
            output.stderr,
          ),
        );
      }
    });
  });
}

type CommandCapture = {
  stdoutPath: string;
  stderrPath: string;
  stdoutFd: number;
  stderrFd: number;
};

function commandCaptureFiles(cwd: string): CommandCapture {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stdoutPath = path.join(cwd, `.henosis-command-${token}.stdout`);
  const stderrPath = path.join(cwd, `.henosis-command-${token}.stderr`);
  return {
    stdoutPath,
    stderrPath,
    stdoutFd: openSync(stdoutPath, "w"),
    stderrFd: openSync(stderrPath, "w"),
  };
}

function readCommandCapture(capture: CommandCapture): {
  stdout: string;
  stderr: string;
} {
  closeSync(capture.stdoutFd);
  closeSync(capture.stderrFd);
  const stdout = readFileSync(capture.stdoutPath, "utf8");
  const stderr = readFileSync(capture.stderrPath, "utf8");
  unlinkSync(capture.stdoutPath);
  unlinkSync(capture.stderrPath);
  return { stdout, stderr };
}

class CommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

function parseWorkerOutput(source: string): WorkerOutput {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new Error("Worker returned malformed output");
  }
  if (value.ok) {
    if (!isPlatformInfo(value.platform)) {
      throw new Error("Worker omitted platform discovery data");
    }
    return value as WorkerOutput;
  }
  if (!isPipelineFailure(value.failure)) {
    throw new Error("Worker omitted its structured failure");
  }
  return value as WorkerOutput;
}

function isPlatformInfo(value: unknown): value is ComponentPlatformInfo {
  return (
    isRecord(value) &&
    isRecord(value.identity) &&
    typeof value.identity.packageName === "string" &&
    typeof value.identity.packageVersion === "string" &&
    value.identity.apiVersion === 2 &&
    Array.isArray(value.stableEnvKinds) &&
    value.stableEnvKinds.every((kind) => typeof kind === "string")
  );
}

function isPipelineFailure(value: unknown): value is PipelineFailure {
  return (
    isRecord(value) &&
    typeof value.stage === "string" &&
    typeof value.message === "string"
  );
}

function removeIfPresent(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Worker setup may fail before creating one of the files.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof CommandError) {
    const output = [error.stdout, error.stderr]
      .filter((part) => part.length > 0)
      .join("\n");
    return output.length > 0 ? output : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
