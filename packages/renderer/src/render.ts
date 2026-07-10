import { existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  lstat,
  mkdtemp,
  readlink,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatEnvironment,
  type ComponentDisposition,
  type JsonValue,
  type ResolvedComponentRecord,
} from "@henosis/core";
import {
  assembleWorkspace,
  checkWorkspaceTypes,
  resolveManifestComponents,
  type LocalOverrides,
} from "./assembler.js";
import { enrichGateFailures } from "./contract-diagnostics.js";
import {
  ExecutionPipelineError,
  executeComponents,
  type ExecutionComponent,
  type ExecutionResult,
} from "./execute.js";
import {
  pipelineFailures,
  renderFailure,
  withFailureContext,
  type GateReport,
} from "./gate-report.js";
import { isPinned, parseManifest, type EnvironmentManifest } from "./manifest.js";

/** Deterministic metadata written beside component artifact directories. */
export interface RenderManifest {
  /** Canonical requested environment. */
  readonly environment: string;
  /** Stable manifests whose pin changes require this manifest to re-render. */
  readonly subscriptions: readonly string[];
  /** Component metadata keyed by manifest identity. */
  readonly components: Readonly<Record<string, RenderManifestComponent>>;
}

/** Deterministic metadata for one rendered component. */
export interface RenderManifestComponent {
  /** Source ref selected by the manifest or its follower target. */
  readonly ref: string;
  /** Immutable image digest. */
  readonly digest: string;
  /** Direct or follower pin provenance. */
  readonly source: ExecutionComponent["source"];
  /** Effective context/params environment. */
  readonly effectiveEnvironment: string;
  /** Explicit materialized or borrowed disposition. */
  readonly disposition: ComponentDisposition<string>;
  /** Fully resolved outputs. */
  readonly outputs: JsonValue;
  /** Canonical deploy records; empty when borrowed. */
  readonly records: readonly ResolvedComponentRecord[];
  /** Component-relative artifact paths written separately. */
  readonly artifactPaths: readonly string[];
}

/** Paths and metadata returned after an atomic render publish. */
export interface RenderOutput {
  /** Final deterministic metadata path. */
  readonly manifestPath: string;
  /** Final artifact paths grouped by component. */
  readonly artifactFiles: Readonly<Record<string, readonly string[]>>;
  /** In-memory deterministic metadata. */
  readonly manifest: RenderManifest;
}

const STRUCTURED_RENDER_FAILURE_PREFIX = "HENOSIS_GATE_REPORT:";

class RenderGateReportError extends Error {
  constructor(readonly report: GateReport) {
    super(report.failures[0]?.message ?? "Render failed");
  }
}

/** Installs, typechecks, executes, and atomically writes one manifest world. */
export async function renderManifest(opts: {
  /** Requested environment manifest. */
  readonly manifest: EnvironmentManifest;
  /** Current dev manifest for live follower resolution. */
  readonly devManifest: EnvironmentManifest;
  /** Stable manifests available as generalized follower targets. */
  readonly stableManifests?: Readonly<Record<string, EnvironmentManifest>>;
  /** Disposable install workspace. */
  readonly scratchDir: string;
  /** Final rendered world directory. */
  readonly outputDir: string;
  /** Platform source ref used by package overrides. */
  readonly platformRef: string;
  /** Local platform repository root. */
  readonly platformRoot: string;
  /** Optional local package overrides. */
  readonly localOverrides?: LocalOverrides;
}): Promise<RenderOutput> {
  const assembly = await assembleWorkspace({
    manifest: opts.manifest,
    devManifest: opts.devManifest,
    stableManifests: opts.stableManifests,
    scratchDir: opts.scratchDir,
    platformRef: opts.platformRef,
    localOverrides: opts.localOverrides,
  });
  if (!assembly.ok) {
    throw new Error(assembly.compileOutput ?? "Workspace assembly failed");
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
      stableManifests: opts.stableManifests,
      scratchDir: opts.scratchDir,
      platformRoot: opts.platformRoot,
      localOverrides: opts.localOverrides,
    });
  } catch (error) {
    throw await renderGateReportError(error, opts);
  }
  return writeRenderOutput({ execution, outputDir: opts.outputDir });
}

async function renderGateReportError(
  error: unknown,
  opts: {
    manifest: EnvironmentManifest;
    devManifest: EnvironmentManifest;
    stableManifests?: Readonly<Record<string, EnvironmentManifest>>;
    scratchDir: string;
    platformRef: string;
    localOverrides?: LocalOverrides;
  },
): Promise<RenderGateReportError> {
  const components = resolveManifestComponents({
    manifest: opts.manifest,
    stableManifests: {
      dev: opts.devManifest,
      ...(opts.stableManifests ?? {}),
    },
  });
  const rawFailures =
    error instanceof ExecutionPipelineError
      ? pipelineFailures(error.failure, opts.manifest.environment)
      : withFailureContext(
          [renderFailure(errorMessage(error))],
          opts.manifest.environment,
          "render",
        );
  const failures = await enrichGateFailures(rawFailures, {
    scratchDir: opts.scratchDir,
    components,
    platformRef: opts.platformRef,
    localOverrides: opts.localOverrides ?? {},
  });
  return new RenderGateReportError({ ok: false, failures });
}

/** Atomically writes projected component files and deterministic metadata. */
export async function writeRenderOutput(opts: {
  /** Completed core execution result. */
  readonly execution: ExecutionResult;
  /** Final environment output directory. */
  readonly outputDir: string;
}): Promise<RenderOutput> {
  const outputDir = path.resolve(opts.outputDir);
  const parent = path.dirname(outputDir);
  await mkdir(parent, { recursive: true });
  const versionsDir = path.join(parent, `.${path.basename(outputDir)}.versions`);
  await mkdir(versionsDir, { recursive: true });
  const staging = await mkdtemp(
    path.join(versionsDir, "world-"),
  );
  const components = Object.entries(opts.execution.components).sort(
    ([left], [right]) => compareCodeUnits(left, right),
  );
  const manifest: RenderManifest = {
    environment: formatEnvironment(opts.execution.env),
    subscriptions: opts.execution.subscriptions,
    components: Object.fromEntries(
      components.map(([name, component]) => [
        name,
        formatComponentRenderData(component),
      ]),
    ),
  };
  const relativeArtifactFiles: Record<string, string[]> = {};

  try {
    for (const [name, component] of components) {
      assertComponentName(name);
      const componentRoot = path.join(staging, "components", name);
      relativeArtifactFiles[name] = [];
      for (const artifact of component.artifacts) {
        const filePath = path.resolve(componentRoot, artifact.path);
        const relative = path.relative(componentRoot, filePath);
        if (
          relative.startsWith("..") ||
          path.isAbsolute(relative) ||
          relative.length === 0
        ) {
          throw new Error(`Artifact path escapes component directory: ${artifact.path}`);
        }
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, artifact.contents, { flag: "wx" });
        relativeArtifactFiles[name]?.push(
          path.join("components", name, artifact.path),
        );
      }
    }
    await writeFile(
      path.join(staging, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );
    const previous = await atomicPublishDirectory(staging, outputDir);
    if (previous !== undefined && isWithin(previous, versionsDir)) {
      await rm(previous, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  const artifactFiles = Object.fromEntries(
    Object.entries(relativeArtifactFiles).map(([name, files]) => [
      name,
      files.map((file) => path.join(outputDir, file)),
    ]),
  );
  return {
    manifestPath: path.join(outputDir, "manifest.json"),
    artifactFiles,
    manifest,
  };
}

type RenamePath = (oldPath: string, newPath: string) => Promise<void>;

/** Atomically switches a rendered-directory pointer, preserving the old world on failure. */
export async function atomicPublishDirectory(
  staging: string,
  outputDir: string,
  renamePath: RenamePath = rename,
): Promise<string | undefined> {
  const parent = path.dirname(outputDir);
  const pointer = path.join(
    parent,
    `.${path.basename(outputDir)}.next-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const relativeTarget = path.relative(parent, staging);
  await symlink(relativeTarget, pointer, "dir");

  let previous: string | undefined;
  let legacyBackup: string | undefined;
  try {
    const existing = await lstat(outputDir).catch((error: unknown) => {
      if (isErrno(error, "ENOENT")) return undefined;
      throw error;
    });
    if (existing?.isSymbolicLink()) {
      previous = path.resolve(parent, await readlink(outputDir));
    } else if (existing?.isDirectory()) {
      legacyBackup = path.join(
        path.dirname(staging),
        `legacy-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      await renamePath(outputDir, legacyBackup);
      previous = legacyBackup;
    } else if (existing !== undefined) {
      throw new Error(`Render output path is not a directory: ${outputDir}`);
    }

    try {
      await renamePath(pointer, outputDir);
    } catch (error) {
      if (legacyBackup !== undefined) {
        await renamePath(legacyBackup, outputDir);
      }
      throw error;
    }
    return previous;
  } catch (error) {
    await rm(pointer, { force: true });
    throw error;
  }
}

/** Formats one execution component for deterministic render metadata. */
export function formatComponentRenderData(
  component: ExecutionComponent,
): RenderManifestComponent {
  return {
    ref: component.ref,
    digest: component.digest,
    source: component.source,
    effectiveEnvironment: formatEnvironment(component.effectiveEnv),
    disposition: component.disposition,
    outputs: component.outputs,
    records: component.records,
    artifactPaths: component.artifacts.map((artifact) => artifact.path),
  };
}

/** Flattens resolved outputs for concise CLI summaries. */
export function formatOutputs(outputs: JsonValue): string[] {
  return flattenOutputs(outputs).map(([key, value]) => `${key}=${String(value)}`);
}

/** Returns the local platform repository root. */
export function defaultPlatformRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
}

/** Resolves the current local Git HEAD without invoking version-control commands. */
export function currentPlatformRef(platformRoot: string): string {
  const preparedRefPath = path.join(platformRoot, ".henosis-platform-sha");
  if (existsSync(preparedRefPath)) {
    const preparedRef = readFileSync(preparedRefPath, "utf8").trim();
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(preparedRef)) {
      throw new Error(`Invalid prepared platform ref ${JSON.stringify(preparedRef)}`);
    }
    return preparedRef;
  }
  const gitDir = path.join(platformRoot, ".git");
  const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
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
    if (line.startsWith("#") || line.length === 0) continue;
    const [sha, packedRefName] = line.split(" ");
    if (packedRefName === refName && sha !== undefined) return sha;
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
      flattenOutputs(
        item,
        prefix.length === 0 ? String(index) : `${prefix}.${index}`,
      ),
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
    console.error(
      "Usage: henosis-render <manifest.toml> [--output-dir <dir>] [--local-override name=/path]",
    );
    process.exitCode = 1;
    return;
  }
  const outputDir = optionValue(args, "--output-dir") ?? "rendered-output";
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  const devManifestPath = path.join(path.dirname(manifestPath), "dev.toml");
  const devManifest = parseManifest(await readFile(devManifestPath, "utf8"));
  const stableManifests = await loadFollowerManifests(
    manifest,
    path.dirname(manifestPath),
    devManifest,
  );
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "henosis-render-"));
  const platformRoot = defaultPlatformRoot();
  const platformRef = currentPlatformRef(platformRoot);
  const output = await renderManifest({
    manifest,
    devManifest,
    stableManifests,
    scratchDir,
    outputDir,
    platformRef,
    platformRoot,
    localOverrides: parseLocalOverrides(args),
  });
  const renderedNames = Object.keys(output.artifactFiles).join(", ");
  const renderedPins = Object.entries(manifest.components)
    .flatMap(([name, entry]) =>
      isPinned(entry) ? [`${name}@${entry.ref.slice(0, 7)}`] : [],
    )
    .join(", ");
  console.log(
    `Rendered ${formatEnvironment(manifest.environment)} (${renderedNames}) to ${outputDir}`,
  );
  if (renderedPins.length > 0) console.log(`Rendered pins: ${renderedPins}`);
}

function assertComponentName(value: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`Unsafe component name ${JSON.stringify(value)}`);
  }
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
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

async function loadFollowerManifests(
  manifest: EnvironmentManifest,
  directory: string,
  devManifest: EnvironmentManifest,
): Promise<Readonly<Record<string, EnvironmentManifest>>> {
  const result: Record<string, EnvironmentManifest> = { dev: devManifest };
  const targets = new Set(
    Object.values(manifest.components).flatMap((entry) =>
      entry.kind === "follower" ? [entry.follow] : [],
    ),
  );
  for (const target of [...targets].sort(compareCodeUnits)) {
    if (target === "dev") continue;
    result[target] = parseManifest(
      await readFile(path.join(directory, `${target}.toml`), "utf8"),
    );
  }
  return result;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    if (
      error instanceof RenderGateReportError &&
      process.env.GITHUB_ACTIONS === "true"
    ) {
      console.error(
        `##[error]${STRUCTURED_RENDER_FAILURE_PREFIX}${JSON.stringify(error.report)}`,
      );
    } else {
      console.error(errorMessage(error));
    }
    process.exitCode = 1;
  });
}
