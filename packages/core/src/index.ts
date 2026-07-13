/** The well-known property containing a component's renderer-facing definition. */
export const componentDefinitionSymbol: unique symbol = Symbol.for(
  "henosis.component",
) as never;

const componentRuntimeSymbol: unique symbol = Symbol.for(
  "henosis.component.runtime.v2.d23",
) as never;
const schemaSymbol: unique symbol = Symbol.for("henosis.schema") as never;
const refSymbol: unique symbol = Symbol.for("henosis.ref") as never;
declare const schemaTypeBrand: unique symbol;
declare const refTypeBrand: unique symbol;
declare const resolvedRecordBrand: unique symbol;

/** Reserved JSON key used for collector-stage symbolic output slots. */
export const collectionRefSlotKey = "$henosisRef" as const;

const TYPEID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const TYPEID_VALUES = new Map(
  [...TYPEID_ALPHABET].map((character, index) => [character, index]),
);

/** The fixed representative preview used by the widened merge gate. */
export const representativePreviewName =
  "preview_3jhc7x633z88188fzqhcbbrf84" as const;

/** A platform-defined stable environment or an id-carrying preview. */
export type Environment<StableKind extends string> =
  | { readonly kind: StableKind }
  | { readonly kind: "preview"; readonly id: string };

/** The erased environment shape used at renderer and worker boundaries. */
export type RuntimeEnv =
  | { readonly kind: string }
  | { readonly kind: "preview"; readonly id: string };

/** The unchanged source ref and immutable image digest from a manifest pin. */
export interface ImageRef {
  /** Source revision selected for the component package. */
  readonly ref: string;
  /** Immutable image digest selected for deployment. */
  readonly digest: string;
}

/** Fields supplied by every platform context. */
export interface BuildContext<EnvType extends RuntimeEnv = RuntimeEnv> {
  /** Environment at which this component build is evaluated. */
  readonly env: EnvType;
  /** Unchanged manifest image pin. */
  readonly image: ImageRef;
}

/** A JSON-compatible value after symbolic references are resolved. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A typed symbolic reference to another component output. */
export interface Ref<T> {
  readonly [refTypeBrand]: T;
  readonly [refSymbol]: OutputRefData;
}

/** JSON-shaped data which may contain symbolic output references as leaves. */
export type DeferredJsonValue =
  | string
  | number
  | boolean
  | null
  | Ref<unknown>
  | readonly DeferredJsonValue[]
  | { readonly [key: string]: DeferredJsonValue };

/** A platform record before world-level reference resolution. */
export interface PendingComponentRecord {
  /** Platform-defined record discriminator. */
  readonly kind: string;
  /** Deferred JSON record payload. */
  readonly data: DeferredJsonValue;
}

/** A canonical record constructed only by core's world resolver. */
export interface ResolvedComponentRecord {
  /** Platform-defined record discriminator. */
  readonly kind: string;
  /** Fully resolved JSON record payload. */
  readonly data: JsonValue;
  /** Compile-time evidence that core performed world resolution. */
  readonly [resolvedRecordBrand]: true;
}

/** A deterministic component-relative file projected from resolved records. */
export interface ComponentArtifact {
  /** Lowercase portable path relative to the component output directory. */
  readonly path: string;
  /** Complete deterministic artifact contents. */
  readonly contents: string;
}

/**
 * Core-owned transactional record sink.
 *
 * Platforms may append and check liveness, but cannot inspect, seal, abort, or
 * publish the underlying buffer.
 */
export interface RecordSink {
  /** Appends one record while the component transaction is open. */
  write(record: PendingComponentRecord): void;
  /** Throws if the component transaction is no longer open. */
  assertOpen(): void;
}

/** Input used by a platform to create one author-facing context. */
export interface PlatformContextInput<StableKind extends string>
  extends BuildContext<Environment<StableKind>> {
  /** Manifest component name for this evaluation. */
  readonly componentName: string;
  /** Private append-only record destination for this evaluation. */
  readonly records: RecordSink;
}

/** Lifecycle stage reported when an evaluation transaction aborts. */
export type EvaluationAbortStage =
  | "build"
  | "pending-output-validation"
  | "finish-records";

/** Exactly-once cleanup outcome after a context was successfully created. */
export type ContextOutcome =
  | { readonly status: "sealed" }
  | { readonly status: "aborted"; readonly stage: EvaluationAbortStage };

/** Immutable platform package identity attached to every component definition. */
export interface PlatformIdentity {
  /** Installed platform package name. */
  readonly packageName: string;
  /** Build-generated installed package version. */
  readonly packageVersion: string;
  /** Core/platform seam version. */
  readonly apiVersion: 2;
}

/** Input to the only artifact-producing platform hook. */
export interface ArtifactProjectionInput<StableKind extends string> {
  /** Manifest component name owning these records. */
  readonly componentName: string;
  /** Effective environment used to produce the records. */
  readonly env: Environment<StableKind>;
  /** Canonical, branded records after world-level ref resolution. */
  readonly records: readonly ResolvedComponentRecord[];
}

/** Precise location inside one canonical component record. */
export interface RecordIssueLocation {
  /** Zero-based index in the component record vector. */
  readonly index: number;
  /** RFC 6901 JSON Pointer; the empty string denotes the record root. */
  readonly path: string;
}

/** A structured world-validation finding with a stable machine code. */
export interface ValidationIssue {
  /** Stable validator-specific issue code. */
  readonly code: string;
  /** Human-readable description of the problem. */
  readonly message: string;
  /** Component to which the issue belongs. */
  readonly component: string;
  /** Optional location in that component's resolved records. */
  readonly record?: RecordIssueLocation;
  /** Optional actionable repair guidance. */
  readonly help?: string;
}

/** Validator ownership retained through worker and gate diagnostics. */
export type ValidatorSource = "platform" | "policy";

/** A validation issue after core attaches deterministic provenance. */
export interface ReportedValidationIssue extends ValidationIssue {
  /** Stable id of the validator that emitted this issue. */
  readonly validator: string;
  /** Whether the validator came from the platform or renderer policy. */
  readonly source: ValidatorSource;
}

/** The reason a component does or does not contribute deployable state. */
export type ComponentDisposition<StableKind extends string> =
  | { readonly kind: "materialized" }
  | {
      readonly kind: "borrowed";
      /** Stable environment whose live instance serves preview dependants. */
      readonly from: StableKind;
      /** Effective environment at which borrowed outputs were evaluated. */
      readonly effectiveEnv: { readonly kind: StableKind };
    };

/** One component in the fully resolved validator view. */
export interface ResolvedWorldComponent<StableKind extends string> {
  /** Manifest component name. */
  readonly name: string;
  /** Environment actually selected for its context and params row. */
  readonly effectiveEnv: Environment<StableKind>;
  /** Materialized or explicit borrowed disposition. */
  readonly disposition: ComponentDisposition<StableKind>;
  /** Fully resolved component outputs. */
  readonly outputs: JsonValue;
  /** Evaluation evidence, including records from borrowed target builds. */
  readonly records: readonly ResolvedComponentRecord[];
  /** Actual component dependencies observed while resolving refs. */
  readonly dependencies: readonly string[];
}

/** Complete resolved world passed to intrinsic and policy validators. */
export interface ResolvedWorld<StableKind extends string> {
  /** Environment requested by the renderer. */
  readonly requestedEnv: Environment<StableKind>;
  /** Components keyed by manifest identity. */
  readonly components: Readonly<
    Record<string, ResolvedWorldComponent<StableKind>>
  >;
}

/** A named structured validator over one fully resolved world. */
export interface WorldValidator<StableKind extends string> {
  /** Stable lowercase validator identity. */
  readonly id: string;
  /** Returns every issue; throwing denotes an internal pipeline failure. */
  validate(
    world: ResolvedWorld<StableKind>,
  ): readonly ValidationIssue[];
}

/** Complete core-facing contract implemented by one platform package. */
export interface PlatformSpec<
  Kinds extends readonly [string, ...string[]],
  Context extends BuildContext<Environment<Kinds[number]>>,
> {
  /** Immutable package and API identity. */
  readonly identity: PlatformIdentity;
  /** Ordered stable environment kinds supported by this platform. */
  readonly stableEnvKinds: Kinds;
  /** Creates the author-facing context before the build runs. */
  createContext(input: PlatformContextInput<Kinds[number]>): Context;
  /** Optional record-only work after pending outputs validate. */
  finishRecords?(ctx: Context, records: RecordSink): void;
  /** Runs exactly once after every successfully created context. */
  dispose?(ctx: Context, outcome: ContextOutcome): void;
  /** The only file-production hook; omission means no artifacts. */
  project?(
    input: ArtifactProjectionInput<Kinds[number]>,
  ): readonly ComponentArtifact[];
  /** Platform-intrinsic checks only; organization policy is renderer input. */
  readonly validators?: readonly WorldValidator<Kinds[number]>[];
}

/** Semantic role attached to a published component output. */
export type OutputRole = "ui";

/** Metadata accepted when defining a URL output schema. */
export interface UrlSchemaOptions {
  /** Marks the URL as a user-facing UI entrypoint. */
  readonly role: OutputRole;
}

/** A runtime output schema carrying its inferred TypeScript value. */
export interface Schema<T> {
  /** Optional semantic role for downstream output discovery. */
  readonly role?: OutputRole;
  readonly [schemaTypeBrand]?: T;
  readonly [schemaSymbol]: SchemaData;
}

/** A schema for arbitrary strings. */
export type StringSchema = Schema<string> & { readonly kind: "string" };

/** A schema for absolute HTTP or HTTPS URLs. */
export type UrlSchema = Schema<string> & { readonly kind: "url" };

/** A schema for finite numbers. */
export type NumberSchema = Schema<number> & { readonly kind: "number" };

/** Named child schemas accepted by an object schema. */
export type SchemaShape = {
  readonly [key: string]: Schema<unknown>;
};

/** A schema for one named object shape. */
export interface ObjectSchema<Shape extends SchemaShape>
  extends Schema<{ readonly [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
  readonly kind: "object";
  readonly shape: Shape;
}

/** Infers the concrete value represented by a schema. */
export type InferSchema<S extends Schema<unknown>> =
  S extends Schema<infer Value> ? Value : never;

/** Infers the concrete object represented by a schema shape. */
export type InferShape<Shape extends SchemaShape> = {
  readonly [Key in keyof Shape]: InferSchema<Shape[Key]>;
};

/** Maps a value to its pre-resolution shape with typed refs at any leaf. */
export type BuildValue<T> =
  | Ref<T>
  | (T extends string | number | boolean | null
      ? T
      : T extends readonly unknown[]
        ? { readonly [Key in keyof T]: BuildValue<T[Key]> }
        : T extends object
          ? { readonly [Key in keyof T]: BuildValue<T[Key]> }
          : T);

/** Maps an output schema to the component module's public ref object. */
export type RefObject<S extends Schema<unknown>> =
  S extends ObjectSchema<infer Shape>
    ? { readonly [Key in keyof Shape]: RefObjectForChild<Shape[Key]> }
    : Ref<InferSchema<S>>;

type RefObjectForChild<S extends Schema<unknown>> =
  S extends ObjectSchema<SchemaShape> ? RefObject<S> : Ref<InferSchema<S>>;

/** Every environment row required by a platform, including preview. */
export type ParamsByEnvironment<StableKind extends string> = {
  readonly [Kind in StableKind | "preview"]: object;
};

/** Named homogeneous parameter-table annotation for platform re-exports. */
export type ParamsTable<StableKind extends string, Row extends object> = {
  readonly [Kind in StableKind | "preview"]: Row;
};

/** Rejects rows outside a platform's stable kinds plus preview. */
export type ExactParams<
  StableKind extends string,
  Rows extends ParamsByEnvironment<StableKind>,
> = Rows & {
  readonly [Extra in Exclude<keyof Rows, StableKind | "preview">]: never;
};

/** Component author specification with an exhaustive exact params table. */
export interface ComponentSpecWithParams<
  StableKind extends string,
  Context,
  Output extends ObjectSchema<SchemaShape>,
  Rows extends ParamsByEnvironment<StableKind>,
> {
  /** Static, introspectable output contract. */
  readonly outputs: Output;
  /**
   * If set, previews don't materialize this component. Any component that
   * depends on it in a preview environment is configured against the named
   * environment's instance of it.
   */
  readonly borrowForPreview?: StableKind;
  /** One explicit row for every stable kind and preview, with no extras. */
  readonly params: ExactParams<StableKind, Rows>;
  /** Produces complete outputs using the selected params row. */
  readonly build: (
    ctx: Context,
    params: Rows[StableKind | "preview"],
  ) => BuildValue<InferSchema<Output>>;
}

/** Component author specification whose build has no params argument. */
export interface ComponentSpecWithoutParams<
  StableKind extends string,
  Context,
  Output extends ObjectSchema<SchemaShape>,
> {
  /** Static, introspectable output contract. */
  readonly outputs: Output;
  /**
   * If set, previews don't materialize this component. Any component that
   * depends on it in a preview environment is configured against the named
   * environment's instance of it.
   */
  readonly borrowForPreview?: StableKind;
  /** Params are unavailable on the params-free overload. */
  readonly params?: never;
  /** Produces complete outputs. */
  readonly build: (ctx: Context) => BuildValue<InferSchema<Output>>;
}

/** Renderer-visible immutable definition stored behind the component symbol. */
export interface ComponentDefinition<
  Output extends ObjectSchema<SchemaShape>,
  StableKind extends string = string,
> {
  /** Static output contract. */
  readonly outputs: Output;
  /** Optional preview borrowing target selected by the component. */
  readonly borrowForPreview?: StableKind;
  readonly [componentRuntimeSymbol]: ComponentRuntime;
}

/** Default component-package export: output refs plus a symbol definition. */
export type ComponentModule<Output extends ObjectSchema<SchemaShape>> =
  RefObject<Output> & {
    readonly [componentDefinitionSymbol]: ComponentDefinition<Output>;
  };

/** Fully platform-bound component definition helper. */
export interface DefineComponent<StableKind extends string, Context> {
  /** Defines a component with an exact exhaustive params table. */
  <Shape extends SchemaShape, Rows extends ParamsByEnvironment<StableKind>>(
    spec: ComponentSpecWithParams<
      StableKind,
      Context,
      ObjectSchema<Shape>,
      Rows
    >,
  ): ComponentModule<ObjectSchema<Shape>>;
  /** Defines a component with no params table. */
  <Shape extends SchemaShape>(
    spec: ComponentSpecWithoutParams<
      StableKind,
      Context,
      ObjectSchema<Shape>
    >,
  ): ComponentModule<ObjectSchema<Shape>>;
}

/** Typed facade produced after a platform binds its core contract. */
export interface PlatformBinding<StableKind extends string, Context> {
  /** Ordered stable kinds supported by this platform. */
  readonly stableEnvKinds: readonly StableKind[];
  /** Platform-typed component definition helper. */
  readonly defineComponent: DefineComponent<StableKind, Context>;
  /** Parses the strict stable/TypeID environment grammar. */
  parseEnvironment(name: string): Environment<StableKind>;
  /** Formats and validates one platform environment. */
  formatEnvironment(env: Environment<StableKind>): string;
}

/** Public output-schema construction vocabulary. */
export interface SchemaBuilder {
  /** Defines an object schema. */
  object<Shape extends SchemaShape>(shape: Shape): ObjectSchema<Shape>;
  /** Defines a string schema. */
  string(): StringSchema;
  /** Defines an HTTP/HTTPS URL schema with optional output metadata. */
  url(options?: UrlSchemaOptions): UrlSchema;
  /** Defines a finite number schema. */
  number(): NumberSchema;
}

/** Constructors for Henosis output schemas. */
export const h: SchemaBuilder = Object.freeze({
  object<Shape extends SchemaShape>(shape: Shape): ObjectSchema<Shape> {
    return Object.freeze({
      kind: "object" as const,
      shape,
      [schemaSymbol]: { kind: "object" as const, shape },
    });
  },
  string(): StringSchema {
    return leafSchema("string") as StringSchema;
  },
  url(options?: UrlSchemaOptions): UrlSchema {
    if (options !== undefined && options.role !== "ui") {
      throw new Error(`Invalid Henosis output role: ${String(options.role)}`);
    }
    return leafSchema("url", options?.role) as UrlSchema;
  },
  number(): NumberSchema {
    return leafSchema("number") as NumberSchema;
  },
});

/** Package paths retained for actionable duplicate/mixed diagnostics. */
export interface ModuleOrigin {
  /** Installed component package name. */
  readonly componentPackage: string;
  /** Resolved component module path. */
  readonly componentPath: string;
  /** Resolved platform package path used by this component. */
  readonly platformPath: string;
}

/** Imported component default plus its resolved package provenance. */
export interface ImportedComponent {
  /** Manifest component name. */
  readonly name: string;
  /** Imported default export. */
  readonly component: ComponentModule<ObjectSchema<SchemaShape>>;
  /** Resolved component and platform origins. */
  readonly origin: ModuleOrigin;
}

/** Immutable platform facts discovered from component defaults. */
export interface ComponentPlatformInfo {
  /** Discovered platform package identity. */
  readonly identity: PlatformIdentity;
  /** Discovered ordered stable environment kinds. */
  readonly stableEnvKinds: readonly string[];
}

/** One imported component prepared for world execution. */
export interface WorldPlanComponent extends ImportedComponent {
  /** Unchanged resolved manifest image pin. */
  readonly image: ImageRef;
}

/** Complete input to core-owned world execution. */
export interface WorldPlan<StableKind extends string = string> {
  /** Requested render environment. */
  readonly requestedEnv: Environment<StableKind>;
  /** Imported defaults and resolved pins. */
  readonly components: readonly WorldPlanComponent[];
  /** Consumer-to-dependency graph used for preview reverse closure and order. */
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
  /** Preview members changed by this manifest or gate candidate. */
  readonly changed: readonly string[];
  /**
   * Optional in-process organization policy checks.
   *
   * A worker-boundary loading mechanism is deferred until the first policy
   * check exists.
   */
  readonly policyValidators?: readonly WorldValidator<StableKind>[];
}

/** Persistable result for one materialized or borrowed component. */
export interface RenderedWorldComponent<StableKind extends string> {
  /** Effective context/params environment. */
  readonly effectiveEnv: Environment<StableKind>;
  /** Explicit materialized or borrowed disposition. */
  readonly disposition: ComponentDisposition<StableKind>;
  /** Fully resolved outputs. */
  readonly outputs: JsonValue;
  /** Canonical deploy records; empty for borrowed components. */
  readonly records: readonly ResolvedComponentRecord[];
  /** Projected files; empty for borrowed components. */
  readonly artifacts: readonly ComponentArtifact[];
  /** Actual dependencies observed while resolving refs. */
  readonly dependencies: readonly string[];
}

/** Complete render result after build, resolution, validation, and projection. */
export interface RenderResult<StableKind extends string = string> {
  /** Requested render environment. */
  readonly requestedEnv: Environment<StableKind>;
  /** Persistable component results keyed by manifest name. */
  readonly components: Readonly<
    Record<string, RenderedWorldComponent<StableKind>>
  >;
}

/** Stable core-owned pipeline stages used by worker and gate diagnostics. */
export type PipelineStage =
  | "platform-discovery"
  | "environment-validation"
  | "create-context"
  | "build"
  | "pending-output-validation"
  | "finish-records"
  | "dispose"
  | "resolution"
  | "resolved-output-validation"
  | "validator"
  | "world-validation"
  | "projection"
  | "artifact-validation";

/** Structured pipeline failure preserved at process boundaries. */
export interface PipelineFailure {
  /** Stable stage at which execution failed. */
  readonly stage: PipelineStage;
  /** Component responsible when the failure is component-scoped. */
  readonly component?: string;
  /** Human-readable primary error. */
  readonly message: string;
  /** Complete structured validator findings when policy rejected the world. */
  readonly issues?: readonly ReportedValidationIssue[];
}

/** Error wrapper carrying one renderer-safe structured pipeline failure. */
export class PipelineError extends Error {
  /** Creates a pipeline error from its stable serialized failure. */
  constructor(readonly failure: PipelineFailure) {
    super(failure.message);
    this.name = "PipelineError";
  }
}

/** Inputs for the public resolved-record test and platform harness. */
export interface PendingWorldForResolution {
  readonly [component: string]: {
    /** Producer definition used as the immutable ref identity. */
    readonly definition: ComponentDefinition<ObjectSchema<SchemaShape>>;
    /** Pending component outputs. */
    readonly outputs: DeferredJsonValue;
    /** Pending component records. */
    readonly records: readonly PendingComponentRecord[];
  };
}

/** One component returned by the core-owned resolver. */
export interface ResolvedPendingComponent {
  /** Fully resolved outputs. */
  readonly outputs: JsonValue;
  /** Branded fully resolved records. */
  readonly records: readonly ResolvedComponentRecord[];
  /** Actual producer identities observed in outputs and records. */
  readonly dependencies: readonly string[];
}

/** Public resolver result whose records can legally reach a projector. */
export interface ResolvedPendingWorld {
  /** Resolved components keyed by manifest identity. */
  readonly components: Readonly<Record<string, ResolvedPendingComponent>>;
}

/** Options controlling output schema validation. */
export interface ValidationOptions {
  /** Whether symbolic refs are legal at the validation point. */
  readonly allowRefs?: boolean;
}

/** One precise output-schema mismatch. */
export interface OutputValidationIssue {
  /** Dot-path segments from the output root. */
  readonly path: readonly string[];
  /** Schema kind expected at the path. */
  readonly expected: string;
  /** Runtime kind found at the path. */
  readonly actual: string;
}

interface ComponentRuntime {
  readonly descriptor: PlatformDescriptor;
  readonly params?: Readonly<Record<string, object>>;
  readonly build: (ctx: unknown, params?: object) => unknown;
}

interface PlatformDescriptor {
  readonly identity: PlatformIdentity;
  readonly stableEnvKinds: readonly string[];
  readonly createContext: (
    input: PlatformContextInput<string>,
  ) => unknown;
  readonly finishRecords?: (ctx: unknown, records: RecordSink) => void;
  readonly dispose?: (ctx: unknown, outcome: ContextOutcome) => void;
  readonly project?: (
    input: ArtifactProjectionInput<string>,
  ) => readonly ComponentArtifact[];
  readonly validators: readonly WorldValidator<string>[];
}

interface EvaluatedComponent<StableKind extends string> {
  readonly definition: ComponentDefinition<ObjectSchema<SchemaShape>>;
  readonly effectiveEnv: Environment<StableKind>;
  readonly disposition: ComponentDisposition<StableKind>;
  readonly outputs: DeferredJsonValue;
  readonly records: readonly PendingComponentRecord[];
}

interface SchemaData {
  readonly kind: "string" | "url" | "number" | "object";
  readonly role?: OutputRole;
  readonly shape?: SchemaShape;
}

interface OutputRefData {
  readonly source: ComponentDefinition<ObjectSchema<SchemaShape>>;
  readonly path: readonly string[];
}

/**
 * Binds a frozen platform descriptor and returns its sole author-facing helper.
 */
export function definePlatform<
  const Kinds extends readonly [string, ...string[]],
  Context extends BuildContext<Environment<Kinds[number]>>,
>(spec: PlatformSpec<Kinds, Context>): PlatformBinding<Kinds[number], Context> {
  const stableEnvKinds = validateAndCopyStableKinds(spec.stableEnvKinds);
  const identity = Object.freeze({ ...spec.identity });
  assertPlatformIdentity(identity);
  const validators = Object.freeze([...(spec.validators ?? [])]);
  assertValidatorIds(validators);

  const descriptor: PlatformDescriptor = Object.freeze({
    identity,
    stableEnvKinds,
    createContext: (input: PlatformContextInput<string>): unknown =>
      spec.createContext(
        input as PlatformContextInput<Kinds[number]>,
      ),
    ...(spec.finishRecords === undefined
      ? {}
      : {
          finishRecords: (ctx: unknown, records: RecordSink): void =>
            spec.finishRecords?.(ctx as Context, records),
        }),
    ...(spec.dispose === undefined
      ? {}
      : {
          dispose: (ctx: unknown, outcome: ContextOutcome): void =>
            spec.dispose?.(ctx as Context, outcome),
        }),
    ...(spec.project === undefined
      ? {}
      : {
          project: (
            input: ArtifactProjectionInput<string>,
          ): readonly ComponentArtifact[] =>
            spec.project?.(
              input as ArtifactProjectionInput<Kinds[number]>,
            ) ?? [],
        }),
    validators: validators as readonly WorldValidator<string>[],
  });

  const defineComponent = ((value: unknown): unknown =>
    defineForPlatform(descriptor, value)) as DefineComponent<
    Kinds[number],
    Context
  >;

  return Object.freeze({
    stableEnvKinds,
    defineComponent,
    parseEnvironment: (name: string): Environment<Kinds[number]> =>
      parseEnvironmentName(stableEnvKinds, name),
    formatEnvironment: (env: Environment<Kinds[number]>): string => {
      assertSupportedEnvironment(
        stableEnvKinds,
        env as Environment<string>,
      );
      return formatEnvironment(env);
    },
  });
}

/** Gets the immutable definition stored behind a component's well-known symbol. */
export function getComponentDefinition<
  Output extends ObjectSchema<SchemaShape>,
>(component: ComponentModule<Output>): ComponentDefinition<Output> {
  return component[componentDefinitionSymbol];
}

/** Tests whether a value is a Henosis component default export. */
export function isComponentModule(
  value: unknown,
): value is ComponentModule<ObjectSchema<SchemaShape>> {
  if (!isRecord(value) || !(componentDefinitionSymbol in value)) {
    return false;
  }
  const definition = value[componentDefinitionSymbol];
  return isComponentDefinition(definition);
}

/** Tests whether a value is a symbolic Henosis output ref. */
export function isRef(value: unknown): value is Ref<unknown> {
  return isRecord(value) && refSymbol in value && isOutputRefData(value[refSymbol]);
}

/** Gets the immutable producer definition carried by a symbolic ref. */
export function refSourceDefinition(
  value: Ref<unknown>,
): ComponentDefinition<ObjectSchema<SchemaShape>> {
  return value[refSymbol].source;
}

/** Gets the output path carried by a symbolic ref. */
export function refOutputPath(value: Ref<unknown>): readonly string[] {
  return value[refSymbol].path;
}

/**
 * Discovers and verifies a world's one platform descriptor from defaults only.
 */
export function inspectWorldPlatform(
  components: readonly ImportedComponent[],
): ComponentPlatformInfo {
  const descriptor = discoverDescriptor(components);
  return Object.freeze({
    identity: descriptor.identity,
    stableEnvKinds: descriptor.stableEnvKinds,
  });
}

/**
 * Evaluates, resolves, validates, and projects one world with no partial result.
 */
export function evaluateWorld<StableKind extends string>(
  plan: WorldPlan<StableKind>,
): RenderResult<StableKind> {
  let descriptor: PlatformDescriptor;
  try {
    descriptor = discoverDescriptor(plan.components);
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw pipelineFailure("platform-discovery", undefined, error);
  }

  try {
    assertSupportedEnvironment(
      descriptor.stableEnvKinds,
      plan.requestedEnv as Environment<string>,
    );
  } catch (error) {
    throw pipelineFailure("environment-validation", undefined, error);
  }

  const componentByName = new Map(
    plan.components.map((component) => [component.name, component]),
  );
  assertUniqueComponents(plan.components);
  const changed = new Set(plan.changed);
  for (const name of changed) {
    if (!componentByName.has(name)) {
      throw pipelineFailure(
        "environment-validation",
        name,
        new Error(`Changed component ${name} is not present in the world`),
      );
    }
  }
  const reverseClosure = transitiveReverseClosure(
    changed,
    plan.dependencies,
  );
  const order = topologicalComponentOrder(
    plan.components.map((component) => component.name),
    plan.dependencies,
  );
  const evaluated = new Map<string, EvaluatedComponent<StableKind>>();

  for (const name of order) {
    const component = componentByName.get(name);
    if (component === undefined) {
      throw pipelineFailure(
        "environment-validation",
        name,
        new Error(`Missing component ${name}`),
      );
    }
    const definition = getComponentDefinition(component.component);
    const borrowTarget = definition.borrowForPreview;
    const borrowed =
      plan.requestedEnv.kind === "preview" &&
      borrowTarget !== undefined &&
      !reverseClosure.has(name);
    if (
      borrowTarget !== undefined &&
      !descriptor.stableEnvKinds.includes(borrowTarget)
    ) {
      throw pipelineFailure(
        "environment-validation",
        name,
        new Error(`Unsupported borrowForPreview target ${borrowTarget}`),
      );
    }
    const effectiveEnv = (borrowed
      ? { kind: borrowTarget as StableKind }
      : plan.requestedEnv) as Environment<StableKind>;
    const disposition: ComponentDisposition<StableKind> = borrowed
      ? {
          kind: "borrowed",
          from: borrowTarget as StableKind,
          effectiveEnv: { kind: borrowTarget as StableKind },
        }
      : { kind: "materialized" };
    evaluated.set(
      name,
      evaluateOne(
        name,
        component,
        effectiveEnv,
        disposition,
      ),
    );
  }

  let resolved: ResolvedPendingWorld;
  try {
    resolved = resolvePendingWorld(
      Object.fromEntries(
        [...evaluated].map(([name, component]) => [
          name,
          {
            definition: component.definition,
            outputs: component.outputs,
            records: component.records,
          },
        ]),
      ),
    );
  } catch (error) {
    const message = errorMessage(error);
    const component = plan.components.find(({ name }) =>
      message.startsWith(`${name} `),
    )?.name;
    throw pipelineFailure("resolution", component, error);
  }

  const definitionNames = new Map(
    plan.components.map((component) => [
      getComponentDefinition(component.component),
      component.name,
    ]),
  );
  const validatorComponents: Record<
    string,
    ResolvedWorldComponent<StableKind>
  > = {};
  for (const name of order) {
    const component = required(evaluated.get(name));
    const resolvedComponent = required(resolved.components[name]);
    const outputIssues = validateSchema(
      component.definition.outputs,
      resolvedComponent.outputs,
    );
    if (outputIssues.length > 0) {
      const issue = outputIssues[0];
      const pendingValue = deferredValueAtPath(component.outputs, issue?.path ?? []);
      const refSource = isRef(pendingValue)
        ? definitionNames.get(refSourceDefinition(pendingValue))
        : undefined;
      const message = formatOutputIssue(name, issue);
      throw pipelineFailure(
        "resolved-output-validation",
        name,
        new Error(
          refSource === undefined || !isRef(pendingValue)
            ? message
            : `${name} consumes ${refSource}.${refOutputPath(pendingValue).join(".")}: ${message}`,
        ),
      );
    }
    validatorComponents[name] = Object.freeze({
      name,
      effectiveEnv: component.effectiveEnv,
      disposition: component.disposition,
      outputs: resolvedComponent.outputs,
      records: resolvedComponent.records,
      dependencies: resolvedComponent.dependencies,
    });
  }

  const validatorWorld: ResolvedWorld<StableKind> = Object.freeze({
    requestedEnv: plan.requestedEnv,
    components: Object.freeze(validatorComponents),
  });
  const issues = runWorldValidators(
    validatorWorld,
    descriptor.validators as readonly WorldValidator<StableKind>[],
    plan.policyValidators ?? [],
  );
  if (issues.length > 0) {
    throw new PipelineError({
      stage: "world-validation",
      message: `${issues.length} world validation issue(s)`,
      issues,
    });
  }

  const rendered: Record<string, RenderedWorldComponent<StableKind>> = {};
  for (const name of order) {
    const component = required(evaluated.get(name));
    const evidence = required(validatorComponents[name]);
    if (component.disposition.kind === "borrowed") {
      rendered[name] = Object.freeze({
        effectiveEnv: component.effectiveEnv,
        disposition: component.disposition,
        outputs: evidence.outputs,
        records: Object.freeze([]),
        artifacts: Object.freeze([]),
        dependencies: evidence.dependencies,
      });
      continue;
    }

    let projected: readonly ComponentArtifact[] = [];
    if (descriptor.project !== undefined) {
      try {
        projected = descriptor.project({
          componentName: name,
          env: component.effectiveEnv as Environment<string>,
          records: evidence.records,
        });
      } catch (error) {
        throw pipelineFailure("projection", name, error);
      }
    }
    let artifacts: readonly ComponentArtifact[];
    try {
      artifacts = validateAndSortArtifacts(projected);
    } catch (error) {
      throw pipelineFailure("artifact-validation", name, error);
    }
    rendered[name] = Object.freeze({
      effectiveEnv: component.effectiveEnv,
      disposition: component.disposition,
      outputs: evidence.outputs,
      records: evidence.records,
      artifacts,
      dependencies: evidence.dependencies,
    });
  }

  return Object.freeze({
    requestedEnv: plan.requestedEnv,
    components: Object.freeze(rendered),
  });
}

/** One success or failure cell returned by the in-process widened-gate harness. */
export type GateWorldResult<StableKind extends string> =
  | {
      readonly environment: Environment<StableKind>;
      readonly ok: true;
      readonly result: RenderResult<StableKind>;
    }
  | {
      readonly environment: Environment<StableKind>;
      readonly ok: false;
      readonly failure: PipelineFailure;
    };

/**
 * Runs every discovered stable kind plus the fixed representative preview.
 * The preview uses the supplied changed set, so unchanged eligible components
 * can borrow while changed members and reverse-dependants always materialize.
 */
export function evaluateGateWorlds<StableKind extends string>(opts: {
  /** Imported candidate-world components. */
  readonly components: readonly WorldPlanComponent[];
  /** Consumer-to-dependency graph. */
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
  /** Candidate's own changed component names. */
  readonly changed: readonly string[];
  /** Disables non-dev cells when false; dev is unconditional. */
  readonly widened?: boolean;
  /** Optional organization policy checks. */
  readonly policyValidators?: readonly WorldValidator<StableKind>[];
}): readonly GateWorldResult<StableKind>[] {
  const platform = inspectWorldPlatform(opts.components);
  const stableKinds = opts.widened === false
    ? platform.stableEnvKinds.filter((kind) => kind === "dev")
    : platform.stableEnvKinds;
  if (!stableKinds.includes("dev")) {
    throw new PipelineError({
      stage: "environment-validation",
      message: 'The merge gate requires a stable "dev" environment',
    });
  }
  const environments: Environment<StableKind>[] = stableKinds.map(
    (kind) => ({ kind: kind as StableKind }),
  );
  if (opts.widened !== false) {
    environments.push({
      kind: "preview",
      id: representativePreviewName,
    });
  }

  return Object.freeze(
    environments.map((environment): GateWorldResult<StableKind> => {
      try {
        return {
          environment,
          ok: true,
          result: evaluateWorld({
            requestedEnv: environment,
            components: opts.components,
            dependencies: opts.dependencies,
            changed:
              environment.kind === "preview"
                ? opts.changed
                : opts.components.map((component) => component.name),
            ...(opts.policyValidators === undefined
              ? {}
              : { policyValidators: opts.policyValidators }),
          }),
        };
      } catch (error) {
        return {
          environment,
          ok: false,
          failure:
            error instanceof PipelineError
              ? error.failure
              : {
                  stage: "build",
                  message: errorMessage(error),
                },
        };
      }
    }),
  );
}

/**
 * Resolves all outputs and record trees in one definition-identity world pass.
 * This function is the sole public constructor of branded resolved records.
 */
export function resolvePendingWorld(
  pending: PendingWorldForResolution,
): ResolvedPendingWorld {
  const definitionNames = new Map<
    ComponentDefinition<ObjectSchema<SchemaShape>>,
    string
  >();
  for (const [name, component] of Object.entries(pending)) {
    if (definitionNames.has(component.definition)) {
      throw new Error(`Component definition imported more than once (${name})`);
    }
    definitionNames.set(component.definition, name);
  }

  const outputCache = new Map<string, JsonValue>();
  const resolving = new Set<string>();
  const dependencySets = new Map<string, Set<string>>();

  const dependenciesFor = (name: string): Set<string> => {
    let dependencies = dependencySets.get(name);
    if (dependencies === undefined) {
      dependencies = new Set<string>();
      dependencySets.set(name, dependencies);
    }
    return dependencies;
  };

  const resolveOutput = (name: string): JsonValue => {
    const cached = outputCache.get(name);
    if (cached !== undefined) return cached;
    if (resolving.has(name)) {
      throw new Error(`Component reference cycle at ${name}`);
    }
    const component = pending[name];
    if (component === undefined) {
      throw new Error(`Missing referenced component ${name}`);
    }
    resolving.add(name);
    try {
      const value = resolveDeferredValue(
        component.outputs,
        name,
        definitionNames,
        dependenciesFor(name),
        resolveOutput,
      );
      outputCache.set(name, value);
      return value;
    } finally {
      resolving.delete(name);
    }
  };

  const components: Record<string, ResolvedPendingComponent> = {};
  for (const name of Object.keys(pending).sort(compareCodeUnits)) {
    const component = required(pending[name]);
    const dependencies = dependenciesFor(name);
    const outputs = resolveOutput(name);
    const records = component.records.map((record) =>
      brandResolvedRecord({
        kind: record.kind,
        data: resolveDeferredValue(
          record.data,
          name,
          definitionNames,
          dependencies,
          resolveOutput,
        ),
      }),
    );
    components[name] = Object.freeze({
      outputs,
      records: Object.freeze(records),
      dependencies: Object.freeze(
        [...dependencies].sort(compareCodeUnits),
      ),
    });
  }
  return Object.freeze({ components: Object.freeze(components) });
}

/** Runs intrinsic then policy validators and returns every ordered issue. */
export function runWorldValidators<StableKind extends string>(
  world: ResolvedWorld<StableKind>,
  platformValidators: readonly WorldValidator<StableKind>[],
  policyValidators: readonly WorldValidator<StableKind>[],
): readonly ReportedValidationIssue[] {
  const groups: readonly [
    ValidatorSource,
    readonly WorldValidator<StableKind>[],
  ][] = [
    ["platform", platformValidators],
    ["policy", policyValidators],
  ];
  const seenIds = new Set<string>();
  const collected: Array<
    ReportedValidationIssue & { readonly validatorOrder: number }
  > = [];
  let validatorOrder = 0;

  for (const [source, validators] of groups) {
    for (const validator of validators) {
      if (seenIds.has(validator.id)) {
        throw new PipelineError({
          stage: "validator",
          message: `Duplicate validator id ${validator.id}`,
        });
      }
      seenIds.add(validator.id);
      let issues: readonly ValidationIssue[];
      try {
        issues = validator.validate(world);
      } catch (error) {
        throw new PipelineError({
          stage: "validator",
          message: `Validator ${validator.id} threw: ${errorMessage(error)}`,
        });
      }
      for (const issue of issues) {
        assertValidationIssue(issue, world);
        collected.push(Object.freeze({
          ...issue,
          ...(issue.record === undefined
            ? {}
            : { record: Object.freeze({ ...issue.record }) }),
          validator: validator.id,
          source,
          validatorOrder,
        }));
      }
      validatorOrder += 1;
    }
  }

  collected.sort(
    (left, right) =>
      left.validatorOrder - right.validatorOrder ||
      compareCodeUnits(left.source, right.source) ||
      compareCodeUnits(left.validator, right.validator) ||
      compareCodeUnits(left.component, right.component) ||
      (left.record?.index ?? -1) - (right.record?.index ?? -1) ||
      compareCodeUnits(left.record?.path ?? "", right.record?.path ?? "") ||
      compareCodeUnits(left.code, right.code) ||
      compareCodeUnits(left.message, right.message) ||
      compareCodeUnits(left.help ?? "", right.help ?? ""),
  );

  const result: ReportedValidationIssue[] = [];
  const seen = new Set<string>();
  for (const { validatorOrder: ignored, ...issue } of collected) {
    void ignored;
    const key = canonicalIssueKey(issue);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(Object.freeze(issue));
    }
  }
  return Object.freeze(result);
}

/** Validates a value against an introspectable Henosis output schema. */
export function validateSchema<SchemaType extends Schema<unknown>>(
  schema: SchemaType,
  value: unknown,
  opts: ValidationOptions = {},
): OutputValidationIssue[] {
  return validateAgainstSchema(schema, value, [], opts.allowRefs === true);
}

/** Validates, duplicate-checks, and code-unit sorts projected artifacts. */
export function validateAndSortArtifacts(
  artifacts: readonly ComponentArtifact[],
): readonly ComponentArtifact[] {
  const paths = new Set<string>();
  const result = artifacts.map((artifact) => {
    if (typeof artifact.contents !== "string") {
      throw new Error("Artifact contents must be a string");
    }
    validateArtifactPath(artifact.path);
    if (paths.has(artifact.path)) {
      throw new Error(`Duplicate artifact path ${artifact.path}`);
    }
    paths.add(artifact.path);
    return Object.freeze({
      path: artifact.path,
      contents: artifact.contents,
    });
  });
  return Object.freeze(
    result.sort((left, right) => compareCodeUnits(left.path, right.path)),
  );
}

/** Code-unit comparison, deterministic across locale and ICU versions. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Formats one canonical stable or preview environment identity. */
export function formatEnvironment<StableKind extends string>(
  env: Environment<StableKind>,
): string {
  if (env.kind === "preview" && "id" in env) {
    assertPreviewEnvironmentName(env.id);
    return env.id;
  }
  validateStableKind(env.kind);
  return env.kind;
}

/** Parses the strict stable/TypeID grammar with a marked legacy-preview shim. */
export function parseEnvironmentName<StableKind extends string>(
  stableKinds: readonly StableKind[],
  name: string,
): Environment<StableKind> {
  validateAndCopyStableKinds(stableKinds);
  if (stableKinds.includes(name as StableKind)) {
    return { kind: name as StableKind };
  }
  if (!name.startsWith("preview_") && !name.startsWith("preview-")) {
    throw new Error(
      `Unknown environment ${JSON.stringify(name)}; expected ${stableKinds.join(", ")} or preview_<typeid>`,
    );
  }
  assertPreviewEnvironmentName(name);
  return { kind: "preview", id: name };
}

/** Validates a programmatic environment against a discovered platform. */
export function assertSupportedEnvironment(
  stableKinds: readonly string[],
  env: Environment<string>,
): void {
  if (env.kind === "preview" && "id" in env) {
    assertPreviewEnvironmentName(env.id);
    return;
  }
  if (!stableKinds.includes(env.kind)) {
    throw new Error(
      `Unsupported stable environment ${JSON.stringify(env.kind)}; platform supports ${stableKinds.join(", ")}`,
    );
  }
}

/**
 * Encodes a UUID as a Henosis environment id in canonical TypeID format.
 *
 * Henosis environments always carry a non-empty prefix, so the general
 * TypeID empty-prefix form is deliberately rejected by this helper.
 */
export function typeIdFromUuid(prefix: string, uuid: string): string {
  if (!/^[a-z](?:[a-z_]{0,61}[a-z])?$/.test(prefix)) {
    throw new Error(`Invalid TypeID prefix ${JSON.stringify(prefix)}`);
  }
  const match =
    /^([0-9a-fA-F]{8})-([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-([0-9a-fA-F]{12})$/.exec(
      uuid,
    );
  if (match === null) {
    throw new Error(`Invalid UUID ${JSON.stringify(uuid)}`);
  }
  const hex = match.slice(1).join("").toLowerCase();
  let value = BigInt(`0x${hex}`);
  let suffix = "";
  for (let index = 0; index < 26; index += 1) {
    suffix = TYPEID_ALPHABET[Number(value & 31n)] + suffix;
    value >>= 5n;
  }
  return `${prefix}_${suffix}`;
}

/**
 * Decodes a canonical Henosis environment id and returns its lowercase UUID.
 *
 * The general TypeID empty-prefix form is intentionally unsupported because
 * Henosis environment identities always have a non-empty type prefix.
 */
export function uuidFromTypeId(typeId: string, expectedPrefix?: string): string {
  const separator = typeId.lastIndexOf("_");
  const prefix = separator === -1 ? "" : typeId.slice(0, separator);
  const suffix = separator === -1 ? "" : typeId.slice(separator + 1);
  if (
    !/^[a-z](?:[a-z_]{0,61}[a-z])?$/.test(prefix) ||
    suffix.length !== 26 ||
    !/^[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(suffix) ||
    (expectedPrefix !== undefined && prefix !== expectedPrefix)
  ) {
    throw new Error(`Invalid canonical TypeID ${JSON.stringify(typeId)}`);
  }
  let value = 0n;
  for (const character of suffix) {
    const digit = TYPEID_VALUES.get(character);
    if (digit === undefined) {
      throw new Error(`Invalid canonical TypeID ${JSON.stringify(typeId)}`);
    }
    value = (value << 5n) | BigInt(digit);
  }
  if (value >= 1n << 128n) {
    throw new Error(`TypeID UUID payload overflows 128 bits`);
  }
  const hex = value.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Tests the temporary legacy `preview-...` compatibility grammar.
 *
 * LIVE-V1-COMPAT: delete when the bot emits TypeIDs and no active manifest
 * contains a legacy preview identity.
 */
export function isLegacyPreviewEnvironmentName(name: string): boolean {
  return (
    name.length <= 63 &&
    /^preview-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name)
  );
}

function defineForPlatform(
  descriptor: PlatformDescriptor,
  value: unknown,
): ComponentModule<ObjectSchema<SchemaShape>> {
  if (
    !isRecord(value) ||
    !isObjectSchema(value.outputs) ||
    typeof value.build !== "function"
  ) {
    throw new Error("Invalid component definition");
  }
  assertValidOutputNames(value.outputs);
  const borrowForPreview = value.borrowForPreview;
  if (
    borrowForPreview !== undefined &&
    (typeof borrowForPreview !== "string" ||
      !descriptor.stableEnvKinds.includes(borrowForPreview))
  ) {
    throw new Error(
      `borrowForPreview must be one of ${descriptor.stableEnvKinds.join(", ")}`,
    );
  }
  const params = value.params;
  if (params !== undefined) {
    assertExactParamRows(params, descriptor.stableEnvKinds);
  }
  const runtime: ComponentRuntime = Object.freeze({
    descriptor,
    ...(params === undefined
      ? {}
      : { params: params as Readonly<Record<string, object>> }),
    build: value.build as ComponentRuntime["build"],
  });
  const definition: ComponentDefinition<ObjectSchema<SchemaShape>> =
    Object.freeze({
      outputs: value.outputs,
      ...(borrowForPreview === undefined ? {} : { borrowForPreview }),
      [componentRuntimeSymbol]: runtime,
    });
  const refs = makeRefObject(value.outputs, definition, []);
  Object.defineProperty(refs, componentDefinitionSymbol, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: definition,
  });
  return Object.freeze(refs) as ComponentModule<ObjectSchema<SchemaShape>>;
}

function evaluateOne<StableKind extends string>(
  name: string,
  component: WorldPlanComponent,
  effectiveEnv: Environment<StableKind>,
  disposition: ComponentDisposition<StableKind>,
): EvaluatedComponent<StableKind> {
  const definition = getComponentDefinition(component.component);
  const runtime = definition[componentRuntimeSymbol];
  const sink = new TransactionalRecordSink();
  let context: unknown;

  try {
    context = runtime.descriptor.createContext({
      componentName: name,
      env: effectiveEnv as Environment<string>,
      image: component.image,
      records: sink,
    });
  } catch (error) {
    sink.abort();
    throw pipelineFailure("create-context", name, error);
  }

  const abort = (stage: EvaluationAbortStage, primary: unknown): never => {
    sink.abort();
    let message = errorMessage(primary);
    try {
      runtime.descriptor.dispose?.(context, {
        status: "aborted",
        stage,
      });
    } catch (disposeError) {
      message = `${message}; dispose also failed: ${errorMessage(disposeError)}`;
    }
    throw new PipelineError({ stage, component: name, message });
  };

  let outputs: unknown;
  try {
    if (runtime.params === undefined) {
      outputs = runtime.build(context);
    } else {
      const row = runtime.params[effectiveEnv.kind];
      if (row === undefined) {
        return abort(
          "build",
          new Error(`Missing params row ${effectiveEnv.kind}`),
        );
      }
      outputs = runtime.build(context, row);
    }
  } catch (error) {
    return abort("build", error);
  }

  let outputIssues: OutputValidationIssue[];
  try {
    outputIssues = validateSchema(definition.outputs, outputs, {
      allowRefs: true,
    });
  } catch (error) {
    return abort("pending-output-validation", error);
  }
  if (outputIssues.length > 0) {
    return abort(
      "pending-output-validation",
      new Error(formatOutputIssue(name, outputIssues[0])),
    );
  }

  try {
    runtime.descriptor.finishRecords?.(context, sink);
  } catch (error) {
    return abort("finish-records", error);
  }

  let pendingOutputs: DeferredJsonValue;
  try {
    pendingOutputs = snapshotDeferredValue(outputs as DeferredJsonValue);
  } catch (error) {
    return abort("pending-output-validation", error);
  }
  const records = sink.seal();
  try {
    runtime.descriptor.dispose?.(context, { status: "sealed" });
  } catch (error) {
    throw pipelineFailure("dispose", name, error);
  }

  return Object.freeze({
    definition,
    effectiveEnv,
    disposition,
    outputs: pendingOutputs,
    records,
  });
}

class TransactionalRecordSink implements RecordSink {
  readonly #records: PendingComponentRecord[] = [];
  #state: "open" | "sealed" | "aborted" = "open";

  write(record: PendingComponentRecord): void {
    this.assertOpen();
    if (typeof record.kind !== "string" || record.kind.length === 0) {
      throw new Error("Record kind must be a non-empty string");
    }
    this.#records.push(
      Object.freeze({
        kind: record.kind,
        data: snapshotDeferredValue(record.data),
      }),
    );
  }

  assertOpen(): void {
    if (this.#state !== "open") {
      throw new Error(`Record transaction is ${this.#state}`);
    }
  }

  seal(): readonly PendingComponentRecord[] {
    this.assertOpen();
    this.#state = "sealed";
    return Object.freeze([...this.#records]);
  }

  abort(): void {
    if (this.#state === "open") {
      this.#records.length = 0;
      this.#state = "aborted";
    }
  }
}

function discoverDescriptor(
  components: readonly ImportedComponent[],
): PlatformDescriptor {
  const first = components[0];
  if (first === undefined) {
    throw new PipelineError({
      stage: "platform-discovery",
      message: "A Henosis world must contain at least one component",
    });
  }
  const descriptor = getComponentDefinition(first.component)[
    componentRuntimeSymbol
  ].descriptor;
  for (const component of components.slice(1)) {
    const candidate = getComponentDefinition(component.component)[
      componentRuntimeSymbol
    ].descriptor;
    if (candidate === descriptor) continue;
    const sameMetadata =
      identityKey(candidate.identity) === identityKey(descriptor.identity) &&
      candidate.stableEnvKinds.join("\0") ===
        descriptor.stableEnvKinds.join("\0");
    const problem = sameMetadata
      ? "duplicate platform installation"
      : "mixed platforms";
    throw new PipelineError({
      stage: "platform-discovery",
      component: component.name,
      message:
        `${problem}: component ${first.name} carries ` +
        `${formatIdentity(descriptor.identity)} at ${first.origin.platformPath}; ` +
        `component ${component.name} carries ${formatIdentity(candidate.identity)} ` +
        `at ${component.origin.platformPath}`,
    });
  }
  return descriptor;
}

function assertUniqueComponents(components: readonly ImportedComponent[]): void {
  const names = new Set<string>();
  const definitions = new Set<
    ComponentDefinition<ObjectSchema<SchemaShape>>
  >();
  for (const component of components) {
    if (names.has(component.name)) {
      throw pipelineFailure(
        "platform-discovery",
        component.name,
        new Error(`Duplicate component name ${component.name}`),
      );
    }
    names.add(component.name);
    const definition = getComponentDefinition(component.component);
    if (definitions.has(definition)) {
      throw pipelineFailure(
        "platform-discovery",
        component.name,
        new Error(`Component definition imported more than once`),
      );
    }
    definitions.add(definition);
  }
}

function resolveDeferredValue(
  value: DeferredJsonValue,
  consumer: string,
  definitionNames: ReadonlyMap<
    ComponentDefinition<ObjectSchema<SchemaShape>>,
    string
  >,
  dependencies: Set<string>,
  resolveOutput: (name: string) => JsonValue,
): JsonValue {
  if (isRef(value)) {
    const data = value[refSymbol];
    const source = definitionNames.get(data.source);
    if (source === undefined) {
      throw new Error(
        `${consumer} contains a ref to ${data.path.join(".")} from a component outside this world`,
      );
    }
    dependencies.add(source);
    let current = resolveOutput(source);
    for (const segment of data.path) {
      if (!isRecord(current) || !(segment in current)) {
        throw new Error(
          `${consumer} consumes missing ${source}.${data.path.join(".")}`,
        );
      }
      current = current[segment] as JsonValue;
    }
    return current;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((child) =>
        resolveDeferredValue(
          child,
          consumer,
          definitionNames,
          dependencies,
          resolveOutput,
        ),
      ),
    );
  }
  if (!isRecord(value)) {
    throw new Error(`${consumer} emitted non-JSON data`);
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        resolveDeferredValue(
          child as DeferredJsonValue,
          consumer,
          definitionNames,
          dependencies,
          resolveOutput,
        ),
      ]),
    ),
  );
}

function snapshotDeferredValue(
  value: DeferredJsonValue,
  ancestors: Set<object> = new Set(),
): DeferredJsonValue {
  if (isRef(value)) return value;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value !== "object") {
    throw new Error("Platform record data must be deferred JSON");
  }
  if (ancestors.has(value)) {
    throw new Error("Platform record data must not contain cycles");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((child) => snapshotDeferredValue(child, ancestors)),
      );
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          snapshotDeferredValue(child, ancestors),
        ]),
      ),
    );
  } finally {
    ancestors.delete(value);
  }
}

function deferredValueAtPath(
  value: DeferredJsonValue,
  pathParts: readonly string[],
): DeferredJsonValue | undefined {
  let current: DeferredJsonValue | undefined = value;
  for (const part of pathParts) {
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part] as DeferredJsonValue;
  }
  return current;
}

function makeRefObject(
  schema: ObjectSchema<SchemaShape>,
  source: ComponentDefinition<ObjectSchema<SchemaShape>>,
  prefix: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema.shape).map(([key, child]) => [
      key,
      isObjectSchema(child)
        ? makeRefObject(child, source, [...prefix, key])
        : makeRef(source, [...prefix, key]),
    ]),
  );
}

function makeRef(
  source: ComponentDefinition<ObjectSchema<SchemaShape>>,
  path: readonly string[],
): Ref<unknown> {
  return Object.freeze({
    [refSymbol]: Object.freeze({ source, path: Object.freeze([...path]) }),
  }) as Ref<unknown>;
}

function leafSchema(
  kind: "string" | "url" | "number",
  role?: OutputRole,
): Schema<unknown> {
  const data: SchemaData = Object.freeze({
    kind,
    ...(role === undefined ? {} : { role }),
  });
  return Object.freeze({
    kind,
    ...(role === undefined ? {} : { role }),
    [schemaSymbol]: data,
  });
}

function validateAgainstSchema(
  schema: Schema<unknown>,
  value: unknown,
  path: readonly string[],
  allowRefs: boolean,
): OutputValidationIssue[] {
  if (allowRefs && isRef(value)) return [];
  const data = getSchemaData(schema);
  if (data.kind === "object") {
    if (!isRecord(value)) {
      return [outputIssue(path, "object", actualType(value))];
    }
    const shape = data.shape ?? {};
    const issues: OutputValidationIssue[] = [];
    for (const [key, child] of Object.entries(shape)) {
      if (!(key in value)) {
        issues.push(outputIssue([...path, key], schemaKind(child), "missing"));
      } else {
        issues.push(
          ...validateAgainstSchema(
            child,
            value[key],
            [...path, key],
            allowRefs,
          ),
        );
      }
    }
    for (const key of Object.keys(value)) {
      if (!(key in shape)) {
        issues.push(outputIssue([...path, key], "absent", "unexpected"));
      }
    }
    return issues;
  }
  if (data.kind === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? []
      : [outputIssue(path, "number", actualType(value))];
  }
  if (data.kind === "string") {
    return typeof value === "string"
      ? []
      : [outputIssue(path, "string", actualType(value))];
  }
  return typeof value === "string" && isHttpUrl(value)
    ? []
    : [outputIssue(path, "url", actualType(value))];
}

function outputIssue(
  path: readonly string[],
  expected: string,
  actual: string,
): OutputValidationIssue {
  return { path, expected, actual };
}

function formatOutputIssue(
  component: string,
  issue: OutputValidationIssue | undefined,
): string {
  if (issue === undefined) return `${component} output validation failed`;
  const path = issue.path.length === 0 ? "" : `.${issue.path.join(".")}`;
  return `${component}${path} expected ${issue.expected}, got ${issue.actual}`;
}

function actualType(value: unknown): string {
  if (isRef(value)) return "ref";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return isHttpUrl(value) ? "url" : "string";
  return typeof value;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getSchemaData(schema: Schema<unknown>): SchemaData {
  if (!isRecord(schema) || !(schemaSymbol in schema)) {
    throw new Error("Invalid Henosis schema");
  }
  const data = schema[schemaSymbol];
  if (!isSchemaData(data)) throw new Error("Invalid Henosis schema");
  return data;
}

function schemaKind(schema: Schema<unknown>): string {
  return getSchemaData(schema).kind;
}

function isObjectSchema(value: unknown): value is ObjectSchema<SchemaShape> {
  return (
    isRecord(value) &&
    value.kind === "object" &&
    isRecord(value.shape) &&
    schemaSymbol in value
  );
}

function isSchemaData(value: unknown): value is SchemaData {
  return (
    isRecord(value) &&
    (value.kind === "string" ||
      value.kind === "url" ||
      value.kind === "number" ||
      (value.kind === "object" && isRecord(value.shape)))
  );
}

function isComponentDefinition(
  value: unknown,
): value is ComponentDefinition<ObjectSchema<SchemaShape>> {
  return (
    isRecord(value) &&
    isObjectSchema(value.outputs) &&
    componentRuntimeSymbol in value &&
    isComponentRuntime(value[componentRuntimeSymbol])
  );
}

function isComponentRuntime(value: unknown): value is ComponentRuntime {
  return (
    isRecord(value) &&
    isRecord(value.descriptor) &&
    typeof value.build === "function"
  );
}

function isOutputRefData(value: unknown): value is OutputRefData {
  return (
    isRecord(value) &&
    isComponentDefinition(value.source) &&
    Array.isArray(value.path) &&
    value.path.every((segment) => typeof segment === "string")
  );
}

function brandResolvedRecord(record: {
  readonly kind: string;
  readonly data: JsonValue;
}): ResolvedComponentRecord {
  return Object.freeze(record) as ResolvedComponentRecord;
}

function canonicalIssueKey(issue: ReportedValidationIssue): string {
  return JSON.stringify([
    issue.source,
    issue.validator,
    issue.component,
    issue.record?.index ?? null,
    issue.record?.path ?? null,
    issue.code,
    issue.message,
    issue.help ?? null,
  ]);
}

function assertValidationIssue<StableKind extends string>(
  issue: ValidationIssue,
  world: ResolvedWorld<StableKind>,
): void {
  if (!/^[a-z][a-z0-9.-]*$/.test(issue.code)) {
    throw new PipelineError({
      stage: "validator",
      message: `Invalid validation issue code ${issue.code}`,
    });
  }
  const component = world.components[issue.component];
  if (component === undefined) {
    throw new PipelineError({
      stage: "validator",
      message: `Validation issue names unknown component ${issue.component}`,
    });
  }
  if (issue.record !== undefined) {
    if (
      !Number.isInteger(issue.record.index) ||
      issue.record.index < 0 ||
      issue.record.index >= component.records.length
    ) {
      throw new PipelineError({
        stage: "validator",
        message: `Validation issue has invalid record index ${issue.record.index}`,
      });
    }
    if (!isJsonPointer(issue.record.path)) {
      throw new PipelineError({
        stage: "validator",
        message: `Validation issue has invalid JSON Pointer ${issue.record.path}`,
      });
    }
  }
}

function isJsonPointer(value: string): boolean {
  return value === "" || /^(?:\/(?:[^~/]|~[01])*)+$/.test(value);
}

function assertValidatorIds(
  validators: readonly WorldValidator<string>[],
): void {
  const seen = new Set<string>();
  for (const validator of validators) {
    if (!/^[a-z][a-z0-9.-]*$/.test(validator.id)) {
      throw new Error(`Invalid validator id ${validator.id}`);
    }
    if (seen.has(validator.id)) {
      throw new Error(`Duplicate validator id ${validator.id}`);
    }
    seen.add(validator.id);
  }
}

function assertExactParamRows(
  value: unknown,
  stableKinds: readonly string[],
): asserts value is Readonly<Record<string, object>> {
  if (!isRecord(value)) throw new Error("params must be an object");
  const expected = [...stableKinds, "preview"].sort(compareCodeUnits);
  const actual = Object.keys(value).sort(compareCodeUnits);
  if (expected.join("\0") !== actual.join("\0")) {
    throw new Error(
      `params rows must be exactly ${expected.join(", ")}; received ${actual.join(", ")}`,
    );
  }
  for (const key of expected) {
    if (!isRecord(value[key])) {
      throw new Error(`params.${key} must be an object`);
    }
  }
}

function assertValidOutputNames(
  schema: ObjectSchema<SchemaShape>,
  path: readonly string[] = [],
): void {
  for (const [key, child] of Object.entries(schema.shape)) {
    const childPath = [...path, key];
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
      throw new Error(
        `Invalid component output name ${JSON.stringify(childPath.join("."))}: output names must be dot-accessible identifiers`,
      );
    }
    if (
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor"
    ) {
      throw new Error(
        `Invalid component output name ${JSON.stringify(childPath.join("."))}: reserved object property names are not allowed`,
      );
    }
    if (isObjectSchema(child)) {
      assertValidOutputNames(child, childPath);
    }
  }
}

function validateAndCopyStableKinds<const Kinds extends readonly string[]>(
  kinds: Kinds,
): Kinds {
  if (kinds.length === 0) {
    throw new Error("A platform must define at least one stable environment kind");
  }
  const seen = new Set<string>();
  for (const kind of kinds) {
    validateStableKind(kind);
    if (seen.has(kind)) {
      throw new Error(`Duplicate stable environment kind ${kind}`);
    }
    seen.add(kind);
  }
  return Object.freeze([...kinds]) as unknown as Kinds;
}

function validateStableKind(kind: string): void {
  if (
    kind.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(kind) ||
    kind.startsWith("preview")
  ) {
    throw new Error(
      `Invalid or reserved stable environment kind ${JSON.stringify(kind)}`,
    );
  }
}

function assertPreviewEnvironmentName(name: string): void {
  if (isLegacyPreviewEnvironmentName(name)) return;
  const uuid = uuidFromTypeId(name, "preview");
  if (typeIdFromUuid("preview", uuid) !== name) {
    throw new Error(`Non-canonical preview TypeID ${JSON.stringify(name)}`);
  }
}

function assertPlatformIdentity(identity: PlatformIdentity): void {
  if (!/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(identity.packageName)) {
    throw new Error(`Invalid platform package name ${identity.packageName}`);
  }
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(
      identity.packageVersion,
    )
  ) {
    throw new Error(`Invalid platform package version ${identity.packageVersion}`);
  }
  if (identity.apiVersion !== 2) {
    throw new Error(`Unsupported platform API version ${identity.apiVersion}`);
  }
}

function topologicalComponentOrder(
  names: readonly string[],
  graph: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const nameSet = new Set(names);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw pipelineFailure(
        "environment-validation",
        name,
        new Error(`Component dependency cycle at ${name}`),
      );
    }
    visiting.add(name);
    for (const dependency of [...(graph[name] ?? [])].sort(compareCodeUnits)) {
      if (nameSet.has(dependency)) visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  };
  for (const name of [...names].sort(compareCodeUnits)) visit(name);
  return Object.freeze(order);
}

function transitiveReverseClosure(
  seeds: ReadonlySet<string>,
  dependencies: Readonly<Record<string, readonly string[]>>,
): Set<string> {
  const result = new Set(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const dependency = queue.shift();
    if (dependency === undefined) continue;
    for (const [consumer, producerNames] of Object.entries(dependencies)) {
      if (producerNames.includes(dependency) && !result.has(consumer)) {
        result.add(consumer);
        queue.push(consumer);
      }
    }
  }
  return result;
}

function validateArtifactPath(value: string): void {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !/^[a-z0-9][a-z0-9._-]*$/.test(segment),
    )
  ) {
    throw new Error(`Unsafe artifact path ${JSON.stringify(value)}`);
  }
}

function pipelineFailure(
  stage: PipelineStage,
  component: string | undefined,
  error: unknown,
): PipelineError {
  return new PipelineError({
    stage,
    ...(component === undefined ? {} : { component }),
    message: errorMessage(error),
  });
}

function identityKey(identity: PlatformIdentity): string {
  return `${identity.packageName}@${identity.packageVersion}/api-${identity.apiVersion}`;
}

function formatIdentity(identity: PlatformIdentity): string {
  return `${identity.packageName}@${identity.packageVersion} (API ${identity.apiVersion})`;
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Required value was absent");
  return value;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
