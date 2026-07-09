import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The well-known property that stores a component's non-author-facing definition. */
export const componentDefinitionSymbol: unique symbol = Symbol.for(
  "henosis.component",
) as never;
const componentRuntimeSymbol: unique symbol = Symbol.for(
  "henosis.component.runtime.v2",
) as never;
const schemaSymbol: unique symbol = Symbol.for("henosis.schema") as never;
const refSymbol: unique symbol = Symbol.for("henosis.ref") as never;
declare const schemaTypeBrand: unique symbol;
declare const refTypeBrand: unique symbol;

/** A stable environment kind supplied by a platform. `preview` is reserved. */
export type StableEnvKind = string;

/**
 * A platform environment.
 *
 * Stable kinds are chosen by the platform. Preview is always the special kind
 * carrying the complete preview identity.
 */
export type Env<Kind extends StableEnvKind = StableEnvKind> =
  | { readonly kind: Kind }
  | { readonly kind: "preview"; readonly id: string };

/** The environment shape used at platform-independent runtime boundaries. */
export type RuntimeEnv = {
  /** The stable platform kind, or `preview`. */
  readonly kind: string;
  /** The complete identity carried only by a preview environment. */
  readonly id?: string;
};

/** The source ref and immutable image digest selected by a manifest pin. */
export type ImageRef = {
  /** The source revision or image tag from the manifest pin. */
  readonly ref: string;
  /** The immutable image digest from the manifest pin. */
  readonly digest: string;
};

/** The context fields every platform supplies to component builds. */
export type BuildContext<Environment extends RuntimeEnv = RuntimeEnv> = {
  /** The environment this build is executing at. */
  readonly env: Environment;
  /** The image selected for this component. */
  readonly image: ImageRef;
};

/** A JSON-compatible value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A pre-resolution structured record value, including symbolic output refs. */
export type ComponentRecordValue =
  | string
  | number
  | boolean
  | null
  | Ref<unknown>
  | readonly ComponentRecordValue[]
  | { readonly [key: string]: ComponentRecordValue };

/** A structured platform record emitted while evaluating one component. */
export type ComponentRecord = {
  /** A platform-defined discriminator for the structured record. */
  readonly kind: string;
  /** The structured record payload, including pre-resolution output refs. */
  readonly data: ComponentRecordValue;
};

/** A component record after every symbolic output ref has been resolved. */
export type ResolvedComponentRecord = {
  /** A platform-defined discriminator for the structured record. */
  readonly kind: string;
  /** The fully resolved structured record payload. */
  readonly data: JsonValue;
};

/** A deterministic file emitted while evaluating one component. */
export type ComponentArtifact = {
  /** The deterministic path relative to this component's render output. */
  readonly path: string;
  /** The complete deterministic artifact contents. */
  readonly contents: string;
};

/** Receives structured records emitted by a platform lifecycle. */
export type RecordWriter = {
  /** Writes one structured component record. */
  write(record: ComponentRecord): void;
};

/** Receives deterministic artifacts emitted by a platform lifecycle. */
export type ArtifactWriter = {
  /** Writes one component artifact. */
  write(artifact: ComponentArtifact): void;
};

/** The record and artifact destinations for one component evaluation. */
export type ComponentWriters = {
  /** Destination for structured platform records. */
  readonly records: RecordWriter;
  /** Destination for deterministic platform artifacts. */
  readonly artifacts: ArtifactWriter;
};

/** Input used by a platform to create its build context. */
export type PlatformContextInput<Environment extends RuntimeEnv> =
  BuildContext<Environment> & ComponentWriters;

/** All records available to a platform world validator. */
export type WorldRecords<Environment extends RuntimeEnv = RuntimeEnv> = {
  /** The requesting world environment. */
  readonly env: Environment;
  /** Records grouped by manifest component identity. */
  readonly components: Readonly<
    Record<string, readonly ResolvedComponentRecord[]>
  >;
};

/** A platform-provided validation check over a rendered world's records. */
export type WorldValidator<Environment extends RuntimeEnv = RuntimeEnv> = (
  world: WorldRecords<Environment>,
) => void;

/**
 * The lifecycle a platform uses to create context and finish an evaluation.
 *
 * `createContext` runs before the component build. `finalize` runs after a
 * successful build and may emit records or artifacts through the writers.
 */
export type PlatformLifecycle<
  Environment extends RuntimeEnv,
  Context extends BuildContext<Environment>,
> = {
  /** Creates the fully typed platform context before build runs. */
  readonly createContext: (
    input: PlatformContextInput<Environment>,
  ) => Context;
  /** Finalizes the platform after a successful build returns. */
  readonly finalize: (ctx: Context, writers: ComponentWriters) => void;
  /** Optional record-only checks run once per rendered world. */
  readonly validators?: readonly WorldValidator<Environment>[];
};

/** The small core interface a platform implements. */
export type PlatformSpec<
  Kind extends StableEnvKind,
  Context extends BuildContext<Env<Kind>>,
> = PlatformLifecycle<Env<Kind>, Context> & {
  /** Every stable environment kind supported by this platform. */
  readonly stableEnvKinds: readonly Kind[];
};

/** A symbolic reference to one typed component output. */
export type Ref<T> = {
  readonly [refTypeBrand]: T;
  readonly [refSymbol]: OutputRefData;
};

/** A runtime-introspectable schema carrying its inferred TypeScript type. */
export type Schema<T> = {
  readonly [schemaTypeBrand]?: T;
  readonly [schemaSymbol]: SchemaData;
};

/** A schema for arbitrary strings. */
export type StringSchema = Schema<string> & {
  /** Runtime schema discriminator. */
  readonly kind: "string";
};

/** A schema for HTTP or HTTPS URLs. */
export type UrlSchema = Schema<string> & {
  /** Runtime schema discriminator. */
  readonly kind: "url";
};

/** A schema for numbers. */
export type NumberSchema = Schema<number> & {
  /** Runtime schema discriminator. */
  readonly kind: "number";
};

/** The named child schemas accepted by an object schema. */
export type SchemaShape = {
  readonly [key: string]: Schema<unknown>;
};

/** A schema for a named object shape. */
export type ObjectSchema<Shape extends SchemaShape> = Schema<InferShape<Shape>> & {
  /** Runtime schema discriminator. */
  readonly kind: "object";
  /** Named child schemas. */
  readonly shape: Shape;
};

/** Infers the value type represented by a schema. */
export type InferSchema<S extends Schema<unknown>> =
  S extends Schema<infer T> ? T : never;

/** Infers the value object represented by a schema shape. */
export type InferShape<Shape extends SchemaShape> = {
  readonly [K in keyof Shape]: InferSchema<Shape[K]>;
};

/** Maps an output schema to the component module's symbolic ref object. */
export type RefObject<S extends Schema<unknown>> =
  S extends ObjectSchema<infer Shape>
    ? { readonly [K in keyof Shape]: RefObjectForChild<Shape[K]> }
    : Ref<InferSchema<S>>;

type RefObjectForChild<S extends Schema<unknown>> =
  S extends ObjectSchema<SchemaShape> ? RefObject<S> : Ref<InferSchema<S>>;

/** A build value, allowing typed refs anywhere a concrete value can appear. */
export type BuildValue<T> =
  | Ref<T>
  | (T extends string | number | boolean | null
      ? T
      : T extends readonly unknown[]
        ? { readonly [K in keyof T]: BuildValue<T[K]> }
        : T extends object
          ? { readonly [K in keyof T]: BuildValue<T[K]> }
          : T);

/** Every environment row required by a platform, including one preview row. */
export type ParamsByEnv<Kind extends StableEnvKind, P> = {
  readonly [EnvironmentKind in Kind | "preview"]: P;
};

/** A component specification with an exhaustive platform params table. */
export type ComponentWithParamsSpec<
  S extends ObjectSchema<SchemaShape>,
  Kind extends StableEnvKind,
  Context extends BuildContext<Env<Kind>>,
  P,
> = {
  /** The component's static, introspectable output contract. */
  readonly outputs: S;
  /**
   * Can preview traffic use the dev instance?
   *
   * In preview worlds this is honored only when the component is neither a
   * changed member nor a transitive reverse-dependent of one. When honored,
   * the build runs at dev and its artifacts are discarded.
   */
  readonly fallThrough?: boolean;
  /** One explicit parameter row for every platform environment kind. */
  readonly params: ParamsByEnv<Kind, P>;
  /** Produces this component's complete outputs for the selected row. */
  readonly build: (ctx: Context, params: P) => BuildValue<InferSchema<S>>;
};

/** A component specification whose build has no params argument. */
export type ComponentWithoutParamsSpec<
  S extends ObjectSchema<SchemaShape>,
  Kind extends StableEnvKind,
  Context extends BuildContext<Env<Kind>>,
> = {
  /** The component's static, introspectable output contract. */
  readonly outputs: S;
  /**
   * Can preview traffic use the dev instance?
   *
   * In preview worlds this is honored only when the component is neither a
   * changed member nor a transitive reverse-dependent of one. When honored,
   * the build runs at dev and its artifacts are discarded.
   */
  readonly fallThrough?: boolean;
  /** Params are omitted when a build needs no environment parameter row. */
  readonly params?: never;
  /** Produces this component's complete outputs. */
  readonly build: (ctx: Context) => BuildValue<InferSchema<S>>;
};

/** The renderer-visible definition stored behind the component symbol. */
export type ComponentDefinition<S extends ObjectSchema<SchemaShape>> = {
  /** The component's static, introspectable output contract. */
  readonly outputs: S;
  /** Whether preview traffic may use the dev instance when safe. */
  readonly fallThrough: boolean;
  /** The manifest identity bound by the renderer. */
  componentName?: string;
  readonly [componentRuntimeSymbol]: ComponentRuntime;
};

/** The default export shape of a component package. */
export type ComponentModule<S extends ObjectSchema<SchemaShape>> = RefObject<S> & {
  readonly [componentDefinitionSymbol]: ComponentDefinition<S>;
};

/** The fully typed `defineComponent` function a platform re-exports. */
export interface PlatformDefineComponent<
  Kind extends StableEnvKind,
  Context extends BuildContext<Env<Kind>>,
> {
  /** Defines a component with an exhaustive environment params table. */
  <Shape extends SchemaShape, P>(
    spec: ComponentWithParamsSpec<ObjectSchema<Shape>, Kind, Context, P>,
  ): ComponentModule<ObjectSchema<Shape>>;
  /** Defines a component whose build needs no params table. */
  <Shape extends SchemaShape>(
    spec: ComponentWithoutParamsSpec<ObjectSchema<Shape>, Kind, Context>,
  ): ComponentModule<ObjectSchema<Shape>>;
}

/** The typed facade produced once a platform binds its core configuration. */
export type Platform<
  Kind extends StableEnvKind,
  Context extends BuildContext<Env<Kind>>,
> = {
  /** Every stable environment kind supported by the bound platform. */
  readonly stableEnvKinds: readonly Kind[];
  /** The platform-typed component definition function. */
  readonly defineComponent: PlatformDefineComponent<Kind, Context>;
  /** Formats one platform environment. */
  readonly envName: (env: Env<Kind>) => string;
  /** Parses a name using the platform's stable-kind set. */
  readonly envFromName: (name: string) => Env<Kind>;
};

/** Inputs needed to evaluate one component. */
export type EvaluationOptions<Environment extends RuntimeEnv = RuntimeEnv> =
  BuildContext<Environment> & ComponentWriters;

/** The unresolved outputs produced by one component build. */
export type EvaluationResult<T> = {
  /** Outputs before cross-component refs are resolved. */
  readonly outputs: BuildValue<T>;
};

/** Options controlling runtime schema validation. */
export type ValidationOptions = {
  /** Whether symbolic refs are accepted as valid pre-resolution values. */
  readonly allowRefs?: boolean;
};

/** One precise schema validation mismatch. */
export type ValidationIssue = {
  /** The output path at which validation failed. */
  readonly path: readonly string[];
  /** The schema kind expected at the path. */
  readonly expected: string;
  /** The runtime value kind found at the path. */
  readonly actual: string;
};

/** The public schema-construction vocabulary. */
export type SchemaBuilder = {
  /** Defines an object schema. */
  object<Shape extends SchemaShape>(shape: Shape): ObjectSchema<Shape>;
  /** Defines a string schema. */
  string(): StringSchema;
  /** Defines an HTTP/HTTPS URL schema. */
  url(): UrlSchema;
  /** Defines a number schema. */
  number(): NumberSchema;
};

/** Constructors for Henosis output schemas. */
export const h: SchemaBuilder = {
  object<Shape extends SchemaShape>(shape: Shape): ObjectSchema<Shape> {
    return makeObjectSchema(shape);
  },
  string(): StringSchema {
    return makeLeafSchema("string") as StringSchema;
  },
  url(): UrlSchema {
    return makeLeafSchema("url") as UrlSchema;
  },
  number(): NumberSchema {
    return makeLeafSchema("number") as NumberSchema;
  },
};

/** Formats a typed environment for manifest and output boundaries. */
export function envName(env: RuntimeEnv): string {
  return env.kind === "preview" && env.id !== undefined ? env.id : env.kind;
}

/** Parses an environment name using a platform's stable-kind set. */
export function envFromName<const Kind extends StableEnvKind>(
  name: string,
  stableEnvKinds: readonly Kind[],
): Env<Kind> {
  if (stableEnvKinds.some((kind) => kind === name)) {
    return { kind: name as Kind };
  }
  return { kind: "preview", id: name };
}

/** Binds a platform's env set, context lifecycle, writers, and validators. */
export function definePlatform<
  const Kind extends StableEnvKind,
  Context extends BuildContext<Env<Kind>>,
>(spec: PlatformSpec<Kind, Context>): Platform<Kind, Context> {
  assertStableEnvKinds(spec.stableEnvKinds);

  const validators: readonly WorldValidator[] = (spec.validators ?? []).map(
    (validator): WorldValidator =>
      (world) => validator(world as WorldRecords<Env<Kind>>),
  );

  const defineComponent = (<Shape extends SchemaShape, P>(
    componentSpec:
      | ComponentWithParamsSpec<ObjectSchema<Shape>, Kind, Context, P>
      | ComponentWithoutParamsSpec<ObjectSchema<Shape>, Kind, Context>,
  ): ComponentModule<ObjectSchema<Shape>> =>
    definePlatformComponent(componentSpec, spec, validators)) as PlatformDefineComponent<
    Kind,
    Context
  >;

  return Object.freeze({
    stableEnvKinds: Object.freeze([...spec.stableEnvKinds]),
    defineComponent,
    envName: (env: Env<Kind>) => envName(env),
    envFromName: (name: string) => envFromName(name, spec.stableEnvKinds),
  });
}

/** Gets the definition stored behind a component module's well-known symbol. */
export function getComponentDefinition<S extends ObjectSchema<SchemaShape>>(
  component: ComponentModule<S>,
): ComponentDefinition<S> {
  return component[componentDefinitionSymbol];
}

/** Tests whether a value is a Henosis component default export. */
export function isComponentModule(
  value: unknown,
): value is ComponentModule<ObjectSchema<SchemaShape>> {
  return (
    isRecord(value) &&
    componentDefinitionSymbol in value &&
    isComponentDefinition(value[componentDefinitionSymbol])
  );
}

/** Assigns the manifest component identity used by symbolic output refs. */
export function bindComponentIdentity<S extends ObjectSchema<SchemaShape>>(
  component: ComponentModule<S>,
  componentName: string,
): void {
  assertComponentName(componentName);
  component[componentDefinitionSymbol].componentName = componentName;
}

/** Runs one component through its platform lifecycle and build. */
export function evaluateComponent<
  S extends ObjectSchema<SchemaShape>,
  Environment extends RuntimeEnv,
>(
  component: ComponentModule<S>,
  opts: EvaluationOptions<Environment>,
): EvaluationResult<InferSchema<S>> {
  const definition = component[componentDefinitionSymbol];
  return {
    outputs: definition[componentRuntimeSymbol].evaluate(opts) as BuildValue<
      InferSchema<S>
    >,
  };
}

/** Runs each distinct platform validator over the rendered world's records. */
export function runWorldValidators(
  components: readonly ComponentModule<ObjectSchema<SchemaShape>>[],
  world: WorldRecords,
): void {
  const validators = new Set<WorldValidator>();
  for (const component of components) {
    const runtime = component[componentDefinitionSymbol][componentRuntimeSymbol];
    for (const validator of runtime?.validators ?? []) {
      validators.add(validator);
    }
  }
  for (const validator of validators) {
    validator(world);
  }
}

/** Validates a value against an introspectable Henosis schema. */
export function validateSchema<S extends Schema<unknown>>(
  schema: S,
  value: unknown,
  opts: ValidationOptions = {},
): ValidationIssue[] {
  return validateAgainstSchema(schema, value, [], opts.allowRefs === true);
}

/** Tests whether a value is a symbolic Henosis output ref. */
export function isRef(value: unknown): value is Ref<unknown> {
  return isRecord(value) && refSymbol in value && isOutputRefData(value[refSymbol]);
}

/** Gets the source component identity carried by a symbolic ref. */
export function refSourceComponent(value: Ref<unknown>): string | undefined {
  return value[refSymbol].source.componentName;
}

/** Gets the output path carried by a symbolic ref. */
export function refOutputPath(value: Ref<unknown>): readonly string[] {
  return value[refSymbol].path;
}

type LeafKind = "string" | "url" | "number";
type SchemaKind = LeafKind | "object";

type SchemaData = {
  readonly kind: SchemaKind;
  readonly shape?: SchemaShape;
};

type RuntimeEvaluationOptions = BuildContext<RuntimeEnv> & ComponentWriters;

type ComponentRuntime = {
  readonly evaluate: (opts: RuntimeEvaluationOptions) => BuildValue<unknown>;
  readonly validators: readonly WorldValidator[];
};

type OutputRefData = {
  readonly source: ComponentDefinition<ObjectSchema<SchemaShape>>;
  readonly path: readonly string[];
};

function definePlatformComponent<
  Shape extends SchemaShape,
  Kind extends StableEnvKind,
  Context extends BuildContext<Env<Kind>>,
  P,
>(
  componentSpec:
    | ComponentWithParamsSpec<ObjectSchema<Shape>, Kind, Context, P>
    | ComponentWithoutParamsSpec<ObjectSchema<Shape>, Kind, Context>,
  platformSpec: PlatformSpec<Kind, Context>,
  validators: readonly WorldValidator[],
): ComponentModule<ObjectSchema<Shape>> {
  assertValidOutputNames(componentSpec.outputs);
  const definition: ComponentDefinition<ObjectSchema<Shape>> = {
    outputs: componentSpec.outputs,
    fallThrough: componentSpec.fallThrough ?? false,
    componentName: inferComponentName(),
    [componentRuntimeSymbol]: {
      validators,
      evaluate: (opts) => {
        const env = platformEnvironment(opts.env, platformSpec.stableEnvKinds);
        const writers: ComponentWriters = {
          records: opts.records,
          artifacts: opts.artifacts,
        };
        const ctx = platformSpec.createContext({
          env,
          image: opts.image,
          ...writers,
        });
        const outputs =
          "params" in componentSpec && componentSpec.params !== undefined
            ? componentSpec.build(ctx, componentSpec.params[env.kind])
            : (componentSpec.build as (ctx: Context) => BuildValue<InferShape<Shape>>)(
                ctx,
              );
        platformSpec.finalize(ctx, writers);
        return outputs;
      },
    },
  };

  const refs = makeRefObject(componentSpec.outputs, definition, []);
  Object.defineProperty(refs, componentDefinitionSymbol, {
    enumerable: false,
    configurable: false,
    value: definition,
  });

  return refs as ComponentModule<ObjectSchema<Shape>>;
}

function platformEnvironment<Kind extends StableEnvKind>(
  env: RuntimeEnv,
  stableEnvKinds: readonly Kind[],
): Env<Kind> {
  if (env.kind === "preview") {
    if (env.id === undefined || env.id.length === 0) {
      throw new Error("Preview environments must carry a non-empty id");
    }
    return { kind: "preview", id: env.id };
  }
  if (stableEnvKinds.some((kind) => kind === env.kind)) {
    return { kind: env.kind as Kind };
  }
  throw new Error(`Platform does not support environment kind "${env.kind}"`);
}

function makeLeafSchema(kind: LeafKind): StringSchema | UrlSchema | NumberSchema {
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
    case "number":
      return typeof value === "number"
        ? []
        : [issue(pathParts, "number", actualType(value))];
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

function assertValidOutputNames(
  schema: Schema<unknown>,
  pathParts: string[] = [],
): void {
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

function assertStableEnvKinds(kinds: readonly string[]): void {
  if (kinds.length === 0) {
    throw new Error("A platform must define at least one stable environment kind");
  }
  const seen = new Set<string>();
  for (const kind of kinds) {
    if (kind.length === 0) {
      throw new Error("Stable environment kinds must not be empty");
    }
    if (kind === "preview") {
      throw new Error('"preview" is reserved and cannot be a stable environment kind');
    }
    if (seen.has(kind)) {
      throw new Error(`Duplicate stable environment kind "${kind}"`);
    }
    seen.add(kind);
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
  return value.kind === "string" || value.kind === "url" || value.kind === "number";
}

function isComponentDefinition(
  value: unknown,
): value is ComponentDefinition<ObjectSchema<SchemaShape>> {
  return (
    isRecord(value) &&
    "outputs" in value &&
    isComponentRuntime(value[componentRuntimeSymbol])
  );
}

function isComponentRuntime(value: unknown): value is ComponentRuntime {
  return (
    isRecord(value) &&
    typeof value.evaluate === "function" &&
    Array.isArray(value.validators)
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

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
