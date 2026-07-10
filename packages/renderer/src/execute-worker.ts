import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  PipelineError,
  envName,
  evaluateWorld,
  inspectWorldPlatform,
  isComponentModule,
  parseEnvironmentName,
  type ComponentPlatformInfo,
  type ImportedComponent,
  type PipelineFailure,
  type RenderResult,
  type RuntimeEnv,
  type WorldPlanComponent,
} from "@henosis/core";

type WorkerComponentInfo = {
  ref: string;
  digest: string;
};

type WorkerInput = {
  mode: "inspect" | "execute";
  components: Record<string, WorkerComponentInfo>;
  dependencies: Readonly<Record<string, readonly string[]>>;
  requestedEnv: RuntimeEnv;
  changed: readonly string[];
  scratchDir: string;
  outputPath?: string;
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

const inputPath = process.argv[2];
if (inputPath === undefined) throw new Error("Missing worker input path");
const input = parseInput(readFileSync(inputPath, "utf8"));
const output = await run();
const serialized = `${JSON.stringify(output)}\n`;
if (input.outputPath === undefined) {
  process.stdout.write(serialized);
} else {
  writeFileSync(input.outputPath, serialized);
}

async function run(): Promise<WorkerOutput> {
  let imported: readonly ImportedComponent[];
  try {
    imported = await Promise.all(
      Object.keys(input.components)
        .sort(compareCodeUnits)
        .map((name) => importComponent(input.scratchDir, name)),
    );
  } catch (error) {
    return failure("platform-discovery", error);
  }

  let platform: ComponentPlatformInfo;
  try {
    platform = inspectWorldPlatform(imported);
  } catch (error) {
    return error instanceof PipelineError
      ? { ok: false, failure: error.failure }
      : failure("platform-discovery", error);
  }
  if (input.mode === "inspect") return { ok: true, platform };

  try {
    const requestedEnv = parseEnvironmentName(
      platform.stableEnvKinds,
      envName(input.requestedEnv),
    );
    const importedByName = new Map(
      imported.map((component) => [component.name, component]),
    );
    const components: WorldPlanComponent[] = Object.entries(input.components)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([name, info]) => ({
        ...required(importedByName.get(name)),
        image: { ref: info.ref, digest: info.digest },
      }));
    return {
      ok: true,
      platform,
      result: evaluateWorld({
        requestedEnv,
        components,
        dependencies: input.dependencies,
        changed: input.changed,
      }),
    };
  } catch (error) {
    return error instanceof PipelineError
      ? { ok: false, failure: error.failure, platform }
      : failure("build", error, platform);
  }
}

async function importComponent(
  scratchDir: string,
  name: string,
): Promise<ImportedComponent> {
  const packageRoot = path.join(
    scratchDir,
    "node_modules",
    "@henosis",
    name,
  );
  const modulePath = path.join(packageRoot, "src", "index.ts");
  const imported: unknown = await import(pathToFileURL(modulePath).href);
  if (!isRecord(imported) || !isComponentModule(imported.default)) {
    throw new Error(`Package @henosis/${name} did not default-export a component`);
  }
  return {
    name,
    component: imported.default,
    origin: {
      componentPackage: `@henosis/${name}`,
      componentPath: realpathIfPossible(modulePath),
      platformPath: findPlatformPath(packageRoot, modulePath),
    },
  };
}

function findPlatformPath(packageRoot: string, modulePath: string): string {
  const packageJson = parseJsonObject(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const dependencyGroups = [
    packageJson.dependencies,
    packageJson.peerDependencies,
  ].filter(isRecord);
  const dependencyNames = new Set(
    dependencyGroups.flatMap((group) => Object.keys(group)),
  );
  const require = createRequire(pathToFileURL(modulePath));
  for (const dependency of [...dependencyNames].sort(compareCodeUnits)) {
    let entryPath: string;
    try {
      entryPath = require.resolve(dependency);
    } catch {
      continue;
    }
    const dependencyRoot = findPackageRoot(entryPath);
    if (dependencyRoot === undefined) continue;
    try {
      const dependencyJson = parseJsonObject(
        readFileSync(path.join(dependencyRoot, "package.json"), "utf8"),
      );
      if (
        isRecord(dependencyJson.henosis) &&
        dependencyJson.henosis.platform === true
      ) {
        return realpathIfPossible(dependencyRoot);
      }
    } catch {
      // Continue looking through the component's declared dependencies.
    }
  }
  return `<platform imported by ${packageRoot}>`;
}

function findPackageRoot(entryPath: string): string | undefined {
  let directory = path.dirname(entryPath);
  while (directory !== path.dirname(directory)) {
    if (existsSync(path.join(directory, "package.json"))) return directory;
    directory = path.dirname(directory);
  }
  return undefined;
}

function parseInput(source: string): WorkerInput {
  const parsed: unknown = JSON.parse(source);
  if (
    !isRecord(parsed) ||
    (parsed.mode !== "inspect" && parsed.mode !== "execute") ||
    !isRecord(parsed.components) ||
    !isRecord(parsed.dependencies) ||
    !Array.isArray(parsed.changed) ||
    typeof parsed.scratchDir !== "string" ||
    !isRuntimeEnv(parsed.requestedEnv)
  ) {
    throw new Error("Invalid worker input");
  }
  const components: Record<string, WorkerComponentInfo> = {};
  for (const [name, value] of Object.entries(parsed.components)) {
    if (
      !isRecord(value) ||
      typeof value.ref !== "string" ||
      typeof value.digest !== "string"
    ) {
      throw new Error(`Invalid worker component ${name}`);
    }
    components[name] = { ref: value.ref, digest: value.digest };
  }
  const dependencies: Record<string, readonly string[]> = {};
  for (const [name, value] of Object.entries(parsed.dependencies)) {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
      throw new Error(`Invalid worker dependency row ${name}`);
    }
    dependencies[name] = value;
  }
  if (!parsed.changed.every((entry) => typeof entry === "string")) {
    throw new Error("Invalid worker changed set");
  }
  return {
    mode: parsed.mode,
    components,
    dependencies,
    changed: parsed.changed as string[],
    scratchDir: parsed.scratchDir,
    requestedEnv: parsed.requestedEnv,
    outputPath:
      typeof parsed.outputPath === "string" ? parsed.outputPath : undefined,
  };
}

function failure(
  stage: PipelineFailure["stage"],
  error: unknown,
  platform?: ComponentPlatformInfo,
): WorkerOutput {
  return {
    ok: false,
    failure: { stage, message: errorMessage(error) },
    ...(platform === undefined ? {} : { platform }),
  };
}

function isRuntimeEnv(value: unknown): value is RuntimeEnv {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    (value.kind !== "preview" || typeof value.id === "string")
  );
}

function parseJsonObject(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) throw new Error("Expected a JSON object");
  return value;
}

function realpathIfPossible(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return value;
  }
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Required value was absent");
  return value;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
