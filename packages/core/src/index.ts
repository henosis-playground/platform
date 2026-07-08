import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const componentDefinitionSymbol: unique symbol = Symbol.for(
  "henosis.component",
) as never;
const schemaSymbol: unique symbol = Symbol.for(
  "henosis.schema",
) as never;
const refSymbol: unique symbol = Symbol.for("henosis.ref") as never;
declare const schemaTypeBrand: unique symbol;
declare const refTypeBrand: unique symbol;

export type EnvId = string;

export type Env = {
  readonly id: EnvId;
};

export type ImageRef = {
  readonly ref: string;
  readonly digest: string;
};

export type BuildContext = {
  readonly env: Env;
  readonly image: ImageRef;
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ComponentRecord = {
  readonly kind: string;
  readonly data: JsonValue;
};

export type ComponentArtifact = {
  readonly path: string;
  readonly contents: string;
};

export type RecordWriter = {
  write(record: ComponentRecord): void;
};

export type ArtifactWriter = {
  write(artifact: ComponentArtifact): void;
};

export type Ref<T> = {
  readonly [refTypeBrand]: T;
  readonly [refSymbol]: OutputRefData;
};

export type Schema<T> = {
  readonly [schemaTypeBrand]?: T;
  readonly [schemaSymbol]: SchemaData;
};

export type StringSchema = Schema<string> & {
  readonly kind: "string";
};

export type UrlSchema = Schema<string> & {
  readonly kind: "url";
};

export type SchemaShape = {
  readonly [key: string]: Schema<unknown>;
};

export type ObjectSchema<Shape extends SchemaShape> = Schema<InferShape<Shape>> & {
  readonly kind: "object";
  readonly shape: Shape;
};

export type InferSchema<S extends Schema<unknown>> =
  S extends Schema<infer T> ? T : never;

export type InferShape<Shape extends SchemaShape> = {
  readonly [K in keyof Shape]: InferSchema<Shape[K]>;
};

export type RefObject<S extends Schema<unknown>> =
  S extends ObjectSchema<infer Shape>
    ? { readonly [K in keyof Shape]: RefObjectForChild<Shape[K]> }
    : Ref<InferSchema<S>>;

type RefObjectForChild<S extends Schema<unknown>> =
  S extends ObjectSchema<SchemaShape> ? RefObject<S> : Ref<InferSchema<S>>;

export type BuildValue<T> =
  | Ref<T>
  | (T extends string | number | boolean | null
      ? T
      : T extends readonly unknown[]
        ? { readonly [K in keyof T]: BuildValue<T[K]> }
        : T extends object
          ? { readonly [K in keyof T]: BuildValue<T[K]> }
          : T);

export type ComponentSpec<S extends ObjectSchema<SchemaShape>> = {
  readonly outputs: S;
  readonly build: (
    ctx: BuildContext,
    env: Env,
  ) => BuildValue<InferSchema<S>>;
};

export type ComponentDefinition<S extends ObjectSchema<SchemaShape>> = {
  readonly outputs: S;
  readonly build: ComponentSpec<S>["build"];
  componentName?: string;
};

export type ComponentModule<S extends ObjectSchema<SchemaShape>> = RefObject<S> & {
  readonly [componentDefinitionSymbol]: ComponentDefinition<S>;
};

export type EvaluationOptions = {
  readonly env: Env;
  readonly image: ImageRef;
};

export type EvaluationResult<T> = {
  readonly outputs: BuildValue<T>;
  readonly records: readonly ComponentRecord[];
  readonly artifacts: readonly ComponentArtifact[];
};

export type ValidationOptions = {
  readonly allowRefs?: boolean;
};

export type ValidationIssue = {
  readonly path: readonly string[];
  readonly expected: string;
  readonly actual: string;
};

export const h = {
  object<Shape extends SchemaShape>(shape: Shape): ObjectSchema<Shape> {
    return makeObjectSchema(shape);
  },
  string(): StringSchema {
    return makeLeafSchema("string") as StringSchema;
  },
  url(): UrlSchema {
    return makeLeafSchema("url") as UrlSchema;
  },
};

export function defineComponent<Shape extends SchemaShape>(
  spec: ComponentSpec<ObjectSchema<Shape>>,
): ComponentModule<ObjectSchema<Shape>> {
  assertValidOutputNames(spec.outputs);

  const definition: ComponentDefinition<ObjectSchema<Shape>> = {
    outputs: spec.outputs,
    build: spec.build,
    componentName: inferComponentName(),
  };

  const refs = makeRefObject(spec.outputs, definition, []);
  Object.defineProperty(refs, componentDefinitionSymbol, {
    enumerable: false,
    configurable: false,
    value: definition,
  });

  return refs as ComponentModule<ObjectSchema<Shape>>;
}

export function getComponentDefinition<S extends ObjectSchema<SchemaShape>>(
  component: ComponentModule<S>,
): ComponentDefinition<S> {
  return component[componentDefinitionSymbol];
}

export function isComponentModule(
  value: unknown,
): value is ComponentModule<ObjectSchema<SchemaShape>> {
  return (
    isRecord(value) &&
    componentDefinitionSymbol in value &&
    isComponentDefinition(value[componentDefinitionSymbol])
  );
}

export function bindComponentIdentity<S extends ObjectSchema<SchemaShape>>(
  component: ComponentModule<S>,
  componentName: string,
): void {
  assertComponentName(componentName);
  component[componentDefinitionSymbol].componentName = componentName;
}

export function evaluateComponent<S extends ObjectSchema<SchemaShape>>(
  component: ComponentModule<S>,
  opts: EvaluationOptions,
): EvaluationResult<InferSchema<S>> {
  const ctx: BuildContext = {
    env: opts.env,
    image: opts.image,
  };

  const definition = component[componentDefinitionSymbol];
  return {
    outputs: definition.build(ctx, opts.env),
    records: [],
    artifacts: [],
  };
}

export function validateSchema<S extends Schema<unknown>>(
  schema: S,
  value: unknown,
  opts: ValidationOptions = {},
): ValidationIssue[] {
  return validateAgainstSchema(schema, value, [], opts.allowRefs === true);
}

export function isRef(value: unknown): value is Ref<unknown> {
  return isRecord(value) && refSymbol in value && isOutputRefData(value[refSymbol]);
}

export function refSourceComponent(value: Ref<unknown>): string | undefined {
  return value[refSymbol].source.componentName;
}

export function refOutputPath(value: Ref<unknown>): readonly string[] {
  return value[refSymbol].path;
}

type LeafKind = "string" | "url";
type SchemaKind = LeafKind | "object";

type SchemaData = {
  readonly kind: SchemaKind;
  readonly shape?: SchemaShape;
};

type OutputRefData = {
  readonly source: ComponentDefinition<ObjectSchema<SchemaShape>>;
  readonly path: readonly string[];
};

function makeLeafSchema(kind: LeafKind): StringSchema | UrlSchema {
  return Object.freeze({
    kind,
    [schemaSymbol]: { kind },
  });
}

function makeObjectSchema<Shape extends SchemaShape>(
  shape: Shape,
): ObjectSchema<Shape> {
  return Object.freeze({
    kind: "object",
    shape,
    [schemaSymbol]: { kind: "object", shape } satisfies SchemaData,
  });
}

function makeRefObject(
  schema: ObjectSchema<SchemaShape>,
  source: ComponentDefinition<ObjectSchema<SchemaShape>>,
  prefix: readonly string[],
): Record<string, unknown> {
  const refs: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(schema.shape)) {
    if (isObjectSchema(child)) {
      refs[key] = makeRefObject(child, source, [...prefix, key]);
    } else {
      refs[key] = makeRef(source, [...prefix, key]);
    }
  }
  return refs;
}

function makeRef(
  source: ComponentDefinition<ObjectSchema<SchemaShape>>,
  outputPath: readonly string[],
): Ref<unknown> {
  return Object.freeze({
    [refSymbol]: {
      source,
      path: outputPath,
    },
  }) as Ref<unknown>;
}

function validateAgainstSchema(
  schema: Schema<unknown>,
  value: unknown,
  pathParts: readonly string[],
  allowRefs: boolean,
): ValidationIssue[] {
  if (allowRefs && isRef(value)) {
    return [];
  }

  const data = getSchemaData(schema);
  switch (data.kind) {
    case "string":
      return typeof value === "string"
        ? []
        : [issue(pathParts, "string", actualType(value))];
    case "url":
      return typeof value === "string" && isUrl(value)
        ? []
        : [issue(pathParts, "url", actualType(value))];
    case "object":
      return validateObject(data.shape ?? {}, value, pathParts, allowRefs);
  }
}

function validateObject(
  shape: SchemaShape,
  value: unknown,
  pathParts: readonly string[],
  allowRefs: boolean,
): ValidationIssue[] {
  if (!isRecord(value)) {
    return [issue(pathParts, "object", actualType(value))];
  }

  const issues: ValidationIssue[] = [];
  for (const [key, childSchema] of Object.entries(shape)) {
    if (!(key in value)) {
      issues.push(issue([...pathParts, key], schemaExpected(childSchema), "missing"));
      continue;
    }

    issues.push(
      ...validateAgainstSchema(
        childSchema,
        value[key],
        [...pathParts, key],
        allowRefs,
      ),
    );
  }

  return issues;
}

function assertValidOutputNames(schema: Schema<unknown>, pathParts: string[] = []): void {
  if (!isObjectSchema(schema)) {
    return;
  }

  for (const [name, child] of Object.entries(schema.shape)) {
    assertOutputName(name, [...pathParts, name]);
    assertValidOutputNames(child, [...pathParts, name]);
  }
}

function assertOutputName(name: string, pathParts: readonly string[]): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(
      `Invalid component output name "${pathParts.join(".")}": output names must be dot-accessible identifiers`,
    );
  }

  if (name === "__proto__" || name === "prototype" || name === "constructor") {
    throw new Error(
      `Invalid component output name "${pathParts.join(".")}": reserved object property names are not allowed`,
    );
  }
}

function assertComponentName(name: string): void {
  if (name.length === 0) {
    throw new Error("Component name must not be empty");
  }
}

function schemaExpected(schema: Schema<unknown>): string {
  return getSchemaData(schema).kind;
}

function getSchemaData(schema: Schema<unknown>): SchemaData {
  if (!isRecord(schema) || !(schemaSymbol in schema)) {
    throw new Error("Invalid Henosis schema");
  }

  const data = schema[schemaSymbol];
  if (!isSchemaData(data)) {
    throw new Error("Invalid Henosis schema");
  }

  return data;
}

function isObjectSchema(
  schema: Schema<unknown>,
): schema is ObjectSchema<SchemaShape> {
  return getSchemaData(schema).kind === "object";
}

function isSchemaData(value: unknown): value is SchemaData {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "object") {
    return value.shape === undefined || isRecord(value.shape);
  }
  return value.kind === "string" || value.kind === "url";
}

function isComponentDefinition(
  value: unknown,
): value is ComponentDefinition<ObjectSchema<SchemaShape>> {
  return (
    isRecord(value) &&
    "outputs" in value &&
    "build" in value &&
    typeof value.build === "function"
  );
}

function isOutputRefData(value: unknown): value is OutputRefData {
  return (
    isRecord(value) &&
    isComponentDefinition(value.source) &&
    Array.isArray(value.path) &&
    value.path.every((part) => typeof part === "string")
  );
}

function issue(
  pathParts: readonly string[],
  expected: string,
  actual: string,
): ValidationIssue {
  return { path: pathParts, expected, actual };
}

function actualType(value: unknown): string {
  if (isRef(value)) {
    const source = refSourceComponent(value) ?? "unknown";
    return `ref(${source}.${refOutputPath(value).join(".")})`;
  }

  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "string") {
    return isUrl(value) ? "url" : "string";
  }
  return typeof value;
}

function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function inferComponentName(): string | undefined {
  const callsite = componentCallsiteFile();
  if (callsite === undefined) {
    return undefined;
  }

  let dir = path.dirname(callsite);
  while (dir !== path.dirname(dir)) {
    const packagePath = path.join(dir, "package.json");
    if (existsSync(packagePath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
        if (isRecord(parsed) && isRecord(parsed.henosis)) {
          const component = parsed.henosis.component;
          return typeof component === "string" ? component : undefined;
        }
      } catch {
        return undefined;
      }
    }
    dir = path.dirname(dir);
  }

  return undefined;
}

function componentCallsiteFile(): string | undefined {
  const stack = new Error().stack;
  if (stack === undefined) {
    return undefined;
  }

  const lines = stack.split(/\r?\n/).slice(1);
  for (const line of lines) {
    const filePath = stackLineFilePath(line);
    if (filePath === undefined) {
      continue;
    }

    const normalized = filePath.replaceAll("\\", "/");
    if (!normalized.includes("/@henosis/core/")) {
      return filePath;
    }
  }

  return undefined;
}

function stackLineFilePath(line: string): string | undefined {
  const urlMatch = /(file:\/\/[^\s)]+):\d+:\d+/.exec(line);
  if (urlMatch !== null) {
    return fileURLToPath(urlMatch[1]);
  }

  const pathMatch = /(\S+):\d+:\d+\)?$/.exec(line);
  return pathMatch?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
