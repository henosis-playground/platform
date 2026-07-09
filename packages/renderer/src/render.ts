import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envName, type ComponentArtifact, type ComponentRecord, type Env, type JsonValue } from "@henosis/core";
import {
  assembleWorkspace,
  checkWorkspaceTypes,
  resolveManifestComponents,
  type LocalOverrides,
} from "./assembler.js";
import { enrichGateFailures } from "./contract-diagnostics.js";
import {
  executeComponents,
  ExecutionPipelineError,
  validateComponentBuilds,
  type ExecutionComponent,
  type ExecutionResult,
  type PipelineFailure,
} from "./execute.js";
import type { GateFailure, GateReport } from "./gate-report.js";
import { isPinned, parseManifest, type EnvironmentManifest } from "./manifest.js";

export type RenderManifest = {
  environment: string;
  generatedAt: string;
  components: Record<string, RenderManifestComponent>;
};

export type RenderManifestComponent = {
  ref: string;
  digest: string;
  outputs: JsonValue;
  records: readonly ComponentRecord[];
  artifacts: readonly ComponentArtifact[];
};

export type RenderOutput = {
  manifestPath: string;
  componentFiles: Record<string, string>;
  manifest: RenderManifest;
};

const STRUCTURED_RENDER_FAILURE_PREFIX = "HENOSIS_GATE_REPORT:";

class RenderGateReportError extends Error {
  constructor(readonly report: GateReport) {
    super(report.failures[0]?.message ?? "Render failed");
  }
}

export async function renderManifest(opts: {
  manifest: EnvironmentManifest;
  devManifest: EnvironmentManifest;
  scratchDir: string;
  outputDir: string;
  platformRef: string;
  platformRoot: string;
  localOverrides?: LocalOverrides;
}): Promise<RenderOutput> {
  const assembly = await assembleWorkspace({
    manifest: opts.manifest,
    devManifest: opts.devManifest,
    scratchDir: opts.scratchDir,
    platformRef: opts.platformRef,
    localOverrides: opts.localOverrides,
  });

  if (!assembly.ok) {
    throw new Error(assembly.compileOutput ?? "Workspace assembly failed");
  }

  try {
    await validateComponentBuilds({
      manifest: opts.manifest,
      devManifest: opts.devManifest,
      scratchDir: opts.scratchDir,
      platformRoot: opts.platformRoot,
      localOverrides: opts.localOverrides,
    });
  } catch (error) {
    throw await renderGateReportError(error, opts);
  }

  const typeCheck = await checkWorkspaceTypes({ scratchDir: opts.scratchDir });
  if (!typeCheck.ok) {
    throw new Error(typeCheck.compileOutput ?? "Workspace typecheck failed");
  }

  let execution: ExecutionResult;
  try {
    execution = await executeComponents({
      manifest: opts.manifest,
      devManifest: opts.devManifest,
      scratchDir: opts.scratchDir,
      platformRoot: opts.platformRoot,
      localOverrides: opts.localOverrides,
    });
  } catch (error) {
    throw await renderGateReportError(error, opts);
  }

  return writeRenderOutput({
    execution,
    outputDir: opts.outputDir,
  });
}

async function renderGateReportError(
  error: unknown,
  opts: {
    manifest: EnvironmentManifest;
    devManifest: EnvironmentManifest;
    scratchDir: string;
    platformRef: string;
    localOverrides?: LocalOverrides;
  },
): Promise<RenderGateReportError> {
  const components = resolveManifestComponents({
    manifest: opts.manifest,
    devManifest: opts.devManifest,
  });
  const failure =
    error instanceof ExecutionPipelineError
      ? gateFailureFromPipeline(error.failure)
      : gateFailure("renderer", "unknown", "render", errorMessage(error), errorMessage(error));
  const failures = await enrichGateFailures([failure], {
    scratchDir: opts.scratchDir,
    components,
    platformRef: opts.platformRef,
    localOverrides: opts.localOverrides ?? {},
  });
  return new RenderGateReportError({ ok: false, failures });
}

function gateFailureFromPipeline(failure: PipelineFailure): GateFailure {
  return gateFailure(
    failure.component,
    failure.consumerOf ?? "unknown",
    failure.kind,
    failure.message,
    failure.excerpt,
    failure.consumedPaths ?? [],
  );
}

function gateFailure(
  consumer: string,
  producer: string,
  kind: GateFailure["kind"],
  message: string,
  excerpt: string,
  consumedPaths: string[] = [],
): GateFailure {
  return {
    consumer,
    producer,
    pinnedSha: null,
    resolvedSha: null,
    outputsSchemaAtPinned: null,
    outputsSchemaAtResolved: null,
    consumedPaths,
    kind,
    message,
    excerpt,
  };
}

export async function writeRenderOutput(opts: {
  execution: ExecutionResult;
  outputDir: string;
  generatedAt?: string;
}): Promise<RenderOutput> {
  await mkdir(opts.outputDir, { recursive: true });
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const pinnedComponents = Object.entries(opts.execution.components).filter(
    (entry): entry is [string, Extract<ExecutionComponent, { disposition: "pinned" }>] =>
      entry[1].disposition === "pinned",
  );
  const environmentName = envName(opts.execution.env);

  const manifest: RenderManifest = {
    environment: environmentName,
    generatedAt,
    components: Object.fromEntries(
      pinnedComponents.map(([name, component]) => [
        name,
        {
          ref: component.ref,
          digest: component.digest,
          outputs: component.outputs,
          records: component.records,
          artifacts: component.artifacts,
        },
      ]),
    ),
  };

  const componentFiles: Record<string, string> = {};
  for (const [name, component] of pinnedComponents) {
    const filePath = path.join(opts.outputDir, `${environmentName}-${name}.json`);
    await writeFile(
      filePath,
      `${JSON.stringify(formatComponentRenderData(opts.execution.env, name, component), null, 2)}\n`,
    );
    componentFiles[name] = filePath;
  }

  const manifestPath = path.join(opts.outputDir, `${environmentName}-manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { manifestPath, componentFiles, manifest };
}

export function formatComponentRenderData(
  env: Env,
  componentName: string,
  component: Extract<ExecutionComponent, { disposition: "pinned" }>,
): RenderManifestComponent & { component: string; environment: string } {
  return {
    component: componentName,
    environment: envName(env),
    ref: component.ref,
    digest: component.digest,
    outputs: component.outputs,
    records: component.records,
    artifacts: component.artifacts,
  };
}

export function formatOutputs(outputs: JsonValue): string[] {
  return flattenOutputs(outputs).map(([key, value]) => `${key}=${String(value)}`);
}

export function defaultPlatformRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}

export function currentPlatformRef(platformRoot: string): string {
  const gitDir = path.join(platformRoot, ".git");
  const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) {
    return head;
  }

  const refName = head.slice("ref: ".length);
  const looseRefPath = path.join(gitDir, refName);
  if (existsSync(looseRefPath)) {
    return readFileSync(looseRefPath, "utf8").trim();
  }

  const packedRefsPath = path.join(gitDir, "packed-refs");
  const packedRefs = existsSync(packedRefsPath)
    ? readFileSync(packedRefsPath, "utf8").split(/\r?\n/)
    : [];
  for (const line of packedRefs) {
    if (line.startsWith("#") || line.length === 0) {
      continue;
    }
    const [sha, packedRefName] = line.split(" ");
    if (packedRefName === refName && sha !== undefined) {
      return sha;
    }
  }

  throw new Error(`Cannot resolve git HEAD ref ${refName}`);
}

function flattenOutputs(
  value: JsonValue,
  prefix = "",
): Array<[string, string | number | boolean | null]> {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return [[prefix, value]];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenOutputs(item, prefix.length === 0 ? String(index) : `${prefix}.${index}`),
    );
  }

  return Object.entries(value).flatMap(([key, child]) =>
    flattenOutputs(child, prefix.length === 0 ? key : `${prefix}.${key}`),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const manifestPath = args[0];
  if (manifestPath === undefined || args.includes("--help")) {
    console.error("Usage: henosis-render <manifest.toml> [--output-dir <dir>]");
    process.exitCode = 1;
    return;
  }

  const outputDir = optionValue(args, "--output-dir") ?? "rendered-output";
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  const devManifestPath = path.join(path.dirname(manifestPath), "dev.toml");
  const devManifest = parseManifest(await readFile(devManifestPath, "utf8"));
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "henosis-render-"));
  const platformRoot = defaultPlatformRoot();
  const platformRef = currentPlatformRef(platformRoot);

  const output = await renderManifest({
    manifest,
    devManifest,
    scratchDir,
    outputDir,
    platformRef,
    platformRoot,
  });

  const renderedNames = Object.keys(output.componentFiles).join(", ");
  const renderedPins = Object.entries(manifest.components)
    .flatMap(([name, entry]) =>
      isPinned(entry) ? [`${name}@${entry.ref.slice(0, 7)}`] : [],
    )
    .join(", ");
  console.log(
    `Rendered ${envName(manifest.environment)} (${renderedNames}) to ${outputDir}`,
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
    if (error instanceof RenderGateReportError && process.env.GITHUB_ACTIONS === "true") {
      console.error(
        `##[error]${STRUCTURED_RENDER_FAILURE_PREFIX}${JSON.stringify(error.report)}`,
      );
    } else {
      console.error(errorMessage(error));
    }
    process.exitCode = 1;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
