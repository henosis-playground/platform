import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  bindComponentIdentity,
  evaluateComponent,
  getComponentDefinition,
  isComponentModule,
  isRef,
  refOutputPath,
  refSourceComponent,
  validateSchema,
  type BuildValue,
  type ComponentArtifact,
  type ComponentModule,
  type ComponentRecord,
  type Env,
  type JsonValue,
  type ObjectSchema,
  type Ref,
  type SchemaShape,
  type ValidationIssue,
} from "@henosis/core";

type WorkerComponentInfo = {
  disposition: "pinned" | "follow";
  env: Env;
  ref: string;
  digest: string;
};

type WorkerInput = {
  components: Record<string, WorkerComponentInfo>;
  order: string[];
  scratchDir: string;
  outputPath?: string;
};

type WorkerSuccessComponent = {
  disposition: "pinned" | "follow";
  env: Env;
  ref: string;
  digest: string;
  outputs: JsonValue;
  records: readonly ComponentRecord[];
  artifacts: readonly ComponentArtifact[];
};

type WorkerFailure = {
  component: string;
  consumerOf?: string;
  kind: "render" | "validate" | "resolve";
  message: string;
  excerpt: string;
};

type WorkerOutput =
  | {
      ok: true;
      components: Record<string, WorkerSuccessComponent>;
    }
  | WorkerFailureOutput;

type WorkerFailureOutput = {
  ok: false;
  failure: WorkerFailure;
};

type ResolutionResult = { ok: true; value: JsonValue } | WorkerFailureOutput;

type EvaluatedComponent = {
  module: ComponentModule<ObjectSchema<SchemaShape>>;
  outputs: BuildValue<unknown>;
  records: readonly ComponentRecord[];
  artifacts: readonly ComponentArtifact[];
};

const inputPath = process.argv[2];
if (inputPath === undefined) {
  throw new Error("Missing worker input path");
}

const input = parseInput(readFileSync(inputPath, "utf8"));
const modules = new Map<string, ComponentModule<ObjectSchema<SchemaShape>>>();
const evaluated = new Map<string, EvaluatedComponent>();
const resolved = new Map<string, JsonValue>();

const output = await run();
const serializedOutput = `${JSON.stringify(output)}\n`;
if (input.outputPath === undefined) {
  console.log(serializedOutput.trimEnd());
} else {
  writeFileSync(input.outputPath, serializedOutput);
}

async function run(): Promise<WorkerOutput> {
  for (const name of input.order) {
    const imported = await importComponent(input.scratchDir, name);
    bindComponentIdentity(imported, name);
    modules.set(name, imported);
  }

  for (const name of input.order) {
    const info = input.components[name];
    const module = modules.get(name);
    if (info === undefined || module === undefined) {
      return failure({
        component: name,
        kind: "render",
        message: `Missing component info for ${name}`,
      });
    }

    const result = evaluateOne(name, module, info);
    if (!result.ok) {
      return result;
    }
  }

  const components: Record<string, WorkerSuccessComponent> = {};
  for (const name of input.order) {
    const resolution = resolveComponent(name, []);
    if (!resolution.ok) {
      return resolution;
    }

    const evaluatedComponent = evaluated.get(name);
    const info = input.components[name];
    const module = modules.get(name);
    if (
      evaluatedComponent === undefined ||
      info === undefined ||
      module === undefined
    ) {
      return failure({
        component: name,
        kind: "render",
        message: `Worker lost evaluated component ${name}`,
      });
    }

    const validationIssues = validateSchema(
      getComponentDefinition(module).outputs,
      resolution.value,
    );
    if (validationIssues.length > 0) {
      return validationFailure(name, validationIssues[0]);
    }

    components[name] = {
      disposition: info.disposition,
      env: info.env,
      ref: info.ref,
      digest: info.digest,
      outputs: resolution.value,
      records: evaluatedComponent.records,
      artifacts: evaluatedComponent.artifacts,
    };
  }

  return { ok: true, components };
}

function evaluateOne(
  name: string,
  module: ComponentModule<ObjectSchema<SchemaShape>>,
  info: WorkerComponentInfo,
): { ok: true } | WorkerFailureOutput {
  let result;
  try {
    result = evaluateComponent(module, {
      env: info.env,
      image: { ref: info.ref, digest: info.digest },
    });
  } catch (error) {
    return failure({
      component: name,
      kind: "render",
      message: `Failed to evaluate ${name}: ${errorMessage(error)}`,
      excerpt: errorStack(error),
    });
  }

  const issues = validateSchema(getComponentDefinition(module).outputs, result.outputs, {
    allowRefs: true,
  });
  if (issues.length > 0) {
    return validationFailure(name, issues[0]);
  }

  evaluated.set(name, {
    module,
    outputs: result.outputs,
    records: result.records,
    artifacts: result.artifacts,
  });

  return { ok: true };
}

function resolveComponent(
  name: string,
  stack: readonly string[],
): ResolutionResult {
  const cached = resolved.get(name);
  if (cached !== undefined) {
    return { ok: true, value: cached };
  }

  if (stack.includes(name)) {
    const cycle = [...stack, name].join(" -> ");
    return failure({
      component: name,
      kind: "resolve",
      message: `Component reference cycle detected: ${cycle}`,
    });
  }

  const component = evaluated.get(name);
  if (component === undefined) {
    return failure({
      component: name,
      kind: "resolve",
      message: `Cannot resolve ${name}: component was not evaluated`,
    });
  }

  const value = resolveValue(component.outputs, name, [...stack, name]);
  if (!value.ok) {
    return value;
  }

  resolved.set(name, value.value);
  return value;
}

function resolveValue(
  value: BuildValue<unknown>,
  consumer: string,
  stack: readonly string[],
): ResolutionResult {
  if (isRef(value)) {
    return resolveRef(value, consumer, stack);
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { ok: true, value };
  }

  if (Array.isArray(value)) {
    const resolvedItems: JsonValue[] = [];
    for (const item of value) {
      const resolvedItem = resolveValue(item as BuildValue<unknown>, consumer, stack);
      if (!resolvedItem.ok) {
        return resolvedItem;
      }
      resolvedItems.push(resolvedItem.value);
    }
    return { ok: true, value: resolvedItems };
  }

  if (!isRecord(value)) {
    return failure({
      component: consumer,
      kind: "resolve",
      message: `Cannot resolve non-serialisable output value for ${consumer}`,
      excerpt: String(value),
    });
  }

  const resolvedObject: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const resolvedChild = resolveValue(child as BuildValue<unknown>, consumer, stack);
    if (!resolvedChild.ok) {
      return resolvedChild;
    }
    resolvedObject[key] = resolvedChild.value;
  }

  return { ok: true, value: resolvedObject };
}

function resolveRef(
  ref: Ref<unknown>,
  consumer: string,
  stack: readonly string[],
): ResolutionResult {
  const source = refSourceComponent(ref) ?? inferAbsentDependency(consumer);
  const outputPath = refOutputPath(ref);
  const outputName = outputPath.join(".");

  if (source === undefined) {
    return failure({
      component: consumer,
      kind: "resolve",
      message: `${consumer} contains a ref to ${outputName} from an unknown component`,
    });
  }

  if (!(source in input.components)) {
    const message = `${consumer} consumes ${source}.${outputName} which no longer exists`;
    return failure({
      component: consumer,
      consumerOf: source,
      kind: "resolve",
      message,
    });
  }

  const sourceResolved = resolveComponent(source, stack);
  if (!sourceResolved.ok) {
    return sourceResolved;
  }

  const output = getPath(sourceResolved.value, outputPath);
  if (output === undefined) {
    const message = `${consumer} consumes ${source}.${outputName} which no longer exists`;
    return failure({
      component: consumer,
      consumerOf: source,
      kind: "resolve",
      message,
    });
  }

  return { ok: true, value: output };
}

function inferAbsentDependency(consumer: string): string | undefined {
  const packageJsonPath = path.join(
    input.scratchDir,
    "node_modules",
    "@henosis",
    consumer,
    "package.json",
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return undefined;
  }

  const dependencies = isRecord(parsed) && isRecord(parsed.dependencies)
    ? parsed.dependencies
    : {};
  const candidates = Object.keys(dependencies)
    .filter((dependency) => dependency.startsWith("@henosis/"))
    .map((dependency) => dependency.slice("@henosis/".length))
    .filter((dependency) => dependency !== "core")
    .filter((dependency) => dependency !== "platform-mock")
    .filter((dependency) => !(dependency in input.components));

  return candidates.length === 1 ? candidates[0] : undefined;
}

async function importComponent(
  scratchDir: string,
  name: string,
): Promise<ComponentModule<ObjectSchema<SchemaShape>>> {
  const modulePath = path.join(
    scratchDir,
    "node_modules",
    "@henosis",
    name,
    "src",
    "index.ts",
  );
  const imported: unknown = await import(pathToFileURL(modulePath).href);
  if (!isRecord(imported) || !isComponentModule(imported.default)) {
    throw new Error(`Package @henosis/${name} did not default-export a component`);
  }
  return imported.default;
}

function validationFailure(
  component: string,
  issue: ValidationIssue | undefined,
): WorkerFailureOutput {
  if (issue === undefined) {
    return failure({
      component,
      kind: "validate",
      message: `${component} output validation failed`,
    });
  }

  const outputPath = issue.path.join(".");
  const message = `${component}.${outputPath} expected ${issue.expected}, got ${issue.actual}`;
  return failure({
    component,
    kind: "validate",
    message,
  });
}

function failure(opts: {
  component: string;
  consumerOf?: string;
  kind: "render" | "validate" | "resolve";
  message: string;
  excerpt?: string;
}): WorkerFailureOutput {
  return {
    ok: false,
    failure: {
      component: opts.component,
      consumerOf: opts.consumerOf,
      kind: opts.kind,
      message: opts.message,
      excerpt: opts.excerpt ?? opts.message,
    },
  };
}

function getPath(value: JsonValue, pathParts: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const part of pathParts) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function parseInput(source: string): WorkerInput {
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed) || !isRecord(parsed.components) || !Array.isArray(parsed.order)) {
    throw new Error("Invalid worker input");
  }

  if (typeof parsed.scratchDir !== "string") {
    throw new Error("Invalid worker input: scratchDir must be a string");
  }

  const components: Record<string, WorkerComponentInfo> = {};
  for (const [name, value] of Object.entries(parsed.components)) {
    if (
      !isRecord(value) ||
      (value.disposition !== "pinned" && value.disposition !== "follow") ||
      !isEnv(value.env) ||
      typeof value.ref !== "string" ||
      typeof value.digest !== "string"
    ) {
      throw new Error(`Invalid worker input for component ${name}`);
    }

    components[name] = {
      disposition: value.disposition,
      env: value.env,
      ref: value.ref,
      digest: value.digest,
    };
  }

  return {
    scratchDir: parsed.scratchDir,
    outputPath:
      typeof parsed.outputPath === "string" ? parsed.outputPath : undefined,
    components,
    order: parsed.order.map((value) => {
      if (typeof value !== "string") {
        throw new Error("Invalid worker input: order entries must be strings");
      }
      return value;
    }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string {
  return error instanceof Error && error.stack !== undefined
    ? error.stack
    : errorMessage(error);
}

function isEnv(value: unknown): value is Env {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.kind === "dev" ||
    value.kind === "staging" ||
    value.kind === "prod"
  ) {
    return true;
  }

  return value.kind === "preview" && typeof value.id === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
