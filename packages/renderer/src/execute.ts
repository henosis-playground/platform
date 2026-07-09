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
  ComponentRecord,
  JsonValue,
  RuntimeEnv,
} from "@henosis/core";
import {
  previewChangedClosure,
  readComponentDependencyGraph,
  resolveManifestComponents,
  topologicalOrder,
  type LocalOverrides,
  type ResolvedComponent,
} from "./assembler.js";
import type { EnvironmentManifest } from "./manifest.js";

export type FailureKind = "compile" | "render" | "validate" | "resolve";

export type PipelineFailure = {
  component: string;
  consumerOf?: string;
  consumedPaths?: string[];
  kind: FailureKind;
  message: string;
  excerpt: string;
};

export class ExecutionPipelineError extends Error {
  constructor(readonly failure: PipelineFailure) {
    super(failure.message);
  }
}

type ExecutionComponentData = {
  ref: string;
  digest: string;
  env: RuntimeEnv;
  fellThrough: boolean;
  outputs: JsonValue;
  records: readonly ComponentRecord[];
  artifacts: readonly ComponentArtifact[];
};

export type PinnedExecutionComponent = ExecutionComponentData & {
  disposition: "pinned";
};

export type FollowExecutionComponent = ExecutionComponentData & {
  disposition: "follow";
  follows: RuntimeEnv;
};

export type ExecutionComponent =
  | PinnedExecutionComponent
  | FollowExecutionComponent;

export type ExecutionResult = {
  env: RuntimeEnv;
  components: Record<string, ExecutionComponent>;
};

type WorkerComponentInfo = {
  disposition: "pinned" | "follow";
  env: RuntimeEnv;
  ref: string;
  digest: string;
  fallThroughEligible: boolean;
};

type WorkerInput = {
  components: Record<string, WorkerComponentInfo>;
  env: RuntimeEnv;
  order: string[];
  scratchDir: string;
  outputPath: string;
};

type WorkerSuccessComponent = {
  disposition: "pinned" | "follow";
  env: RuntimeEnv;
  ref: string;
  digest: string;
  fellThrough: boolean;
  outputs: JsonValue;
  records: readonly ComponentRecord[];
  artifacts: readonly ComponentArtifact[];
};

type WorkerOutput =
  | {
      ok: true;
      components: Record<string, WorkerSuccessComponent>;
    }
  | {
      ok: false;
      failure: PipelineFailure;
    };

export async function executeComponents(opts: {
  manifest: EnvironmentManifest;
  devManifest: EnvironmentManifest;
  scratchDir: string;
  platformRoot: string;
  localOverrides?: LocalOverrides;
}): Promise<ExecutionResult> {
  void opts.platformRoot;
  void opts.localOverrides;

  const resolved = resolveManifestComponents({
    manifest: opts.manifest,
    devManifest: opts.devManifest,
  });
  const componentNames = resolved.map((component) => component.name);
  const graph = await readComponentDependencyGraph(opts.scratchDir, componentNames);
  const order = topologicalOrder(graph, componentNames);
  const changedClosure = previewChangedClosure(opts.manifest, graph);
  const inputPath = path.join(opts.scratchDir, ".henosis-execute-input.json");
  const outputPath = path.join(opts.scratchDir, ".henosis-execute-output.json");

  const workerInput: WorkerInput = {
    scratchDir: opts.scratchDir,
    outputPath,
    env: opts.manifest.environment,
    order,
    components: workerComponents(
      resolved,
      opts.manifest.environment.kind === "preview",
      changedClosure,
    ),
  };

  await writeFile(inputPath, `${JSON.stringify(workerInput)}\n`);
  const workerOutput = await runWorker(inputPath, outputPath);

  if (!workerOutput.ok) {
    throw new ExecutionPipelineError(workerOutput.failure);
  }

  return {
    env: opts.manifest.environment,
    components: Object.fromEntries(
      resolved.map((component) => {
        const output = workerOutput.components[component.name];
        if (output === undefined) {
          throw new ExecutionPipelineError({
            component: component.name,
            kind: "render",
            message: `Worker did not return outputs for ${component.name}`,
            excerpt: `Worker did not return outputs for ${component.name}`,
          });
        }

        const common: ExecutionComponentData = {
          ref: component.ref,
          digest: component.digest,
          env: output.env,
          fellThrough: output.fellThrough,
          outputs: output.outputs,
          records: output.records,
          artifacts: output.artifacts,
        };
        if (component.disposition === "follow") {
          return [
            component.name,
            {
              ...common,
              disposition: "follow",
              follows: { kind: "dev" },
            } satisfies FollowExecutionComponent,
          ];
        }

        return [
          component.name,
          {
            ...common,
            disposition: "pinned",
          } satisfies PinnedExecutionComponent,
        ];
      }),
    ),
  };
}

function workerComponents(
  resolved: readonly ResolvedComponent[],
  preview: boolean,
  changedClosure: ReadonlySet<string>,
): Record<string, WorkerComponentInfo> {
  return Object.fromEntries(
    resolved.map((component) => [
      component.name,
      {
        disposition: component.disposition,
        env: component.env,
        ref: component.ref,
        digest: component.digest,
        fallThroughEligible: preview && !changedClosure.has(component.name),
      },
    ]),
  );
}

async function runWorker(inputPath: string, outputPath: string): Promise<WorkerOutput> {
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
  } catch (error) {
    throw new ExecutionPipelineError({
      component: "renderer",
      kind: "render",
      message: errorMessage(error),
      excerpt: execErrorOutput(error),
    });
  }

  return parseWorkerOutput(readFileSync(outputPath, "utf8"));
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
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new CommandError(
          `${command} exited with status ${code ?? "unknown"}`,
          output.stdout,
          output.stderr,
        ),
      );
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

function parseWorkerOutput(stdout: string): WorkerOutput {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed) || typeof parsed.ok !== "boolean") {
    throw new ExecutionPipelineError({
      component: "renderer",
      kind: "render",
      message: "Worker returned malformed output",
      excerpt: stdout,
    });
  }

  return parsed as WorkerOutput;
}

function execErrorOutput(error: unknown): string {
  if (error instanceof CommandError) {
    const output = [error.stdout, error.stderr]
      .filter((part) => part.length > 0)
      .join("\n");
    return output.length > 0 ? output : error.message;
  }

  const stdout = stringErrorProperty(error, "stdout");
  const stderr = stringErrorProperty(error, "stderr");
  const output = [stdout, stderr].filter((part) => part.length > 0).join("\n");
  if (output.length > 0) {
    return output;
  }
  return errorMessage(error);
}

function stringErrorProperty(error: unknown, key: "stdout" | "stderr"): string {
  if (!isRecord(error)) {
    return "";
  }

  const value = error[key];
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Buffer) {
    return value.toString("utf8");
  }

  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
