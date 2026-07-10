/** The well-known property containing a component's renderer-facing definition. */
export declare const componentDefinitionSymbol: unique symbol;
declare const componentRuntimeSymbol: unique symbol;
declare const schemaSymbol: unique symbol;
declare const refSymbol: unique symbol;
declare const schemaTypeBrand: unique symbol;
declare const refTypeBrand: unique symbol;
declare const resolvedRecordBrand: unique symbol;
/** The fixed representative preview used by the widened merge gate. */
export declare const representativePreviewName: "preview_3jhc7x633z88188fzqhcbbrf84";
/** A platform-defined stable environment or an id-carrying preview. */
export type Environment<StableKind extends string> = {
    readonly kind: StableKind;
} | {
    readonly kind: "preview";
    readonly id: string;
};
/** The erased environment shape used at renderer and worker boundaries. */
export type RuntimeEnv = {
    readonly kind: string;
} | {
    readonly kind: "preview";
    readonly id: string;
};
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
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
/** A typed symbolic reference to another component output. */
export interface Ref<T> {
    readonly [refTypeBrand]: T;
    readonly [refSymbol]: OutputRefData;
}
/** JSON-shaped data which may contain symbolic output references as leaves. */
export type DeferredJsonValue = string | number | boolean | null | Ref<unknown> | readonly DeferredJsonValue[] | {
    readonly [key: string]: DeferredJsonValue;
};
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
export interface PlatformContextInput<StableKind extends string> extends BuildContext<Environment<StableKind>> {
    /** Manifest component name for this evaluation. */
    readonly componentName: string;
    /** Private append-only record destination for this evaluation. */
    readonly records: RecordSink;
}
/** Lifecycle stage reported when an evaluation transaction aborts. */
export type EvaluationAbortStage = "build" | "pending-output-validation" | "finish-records";
/** Exactly-once cleanup outcome after a context was successfully created. */
export type ContextOutcome = {
    readonly status: "sealed";
} | {
    readonly status: "aborted";
    readonly stage: EvaluationAbortStage;
};
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
export type ComponentDisposition<StableKind extends string> = {
    readonly kind: "materialized";
} | {
    readonly kind: "borrowed";
    /** Stable environment whose live instance serves preview dependants. */
    readonly from: StableKind;
    /** Effective environment at which borrowed outputs were evaluated. */
    readonly effectiveEnv: {
        readonly kind: StableKind;
    };
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
    readonly components: Readonly<Record<string, ResolvedWorldComponent<StableKind>>>;
}
/** A named structured validator over one fully resolved world. */
export interface WorldValidator<StableKind extends string> {
    /** Stable lowercase validator identity. */
    readonly id: string;
    /** Returns every issue; throwing denotes an internal pipeline failure. */
    validate(world: ResolvedWorld<StableKind>): readonly ValidationIssue[];
}
/** Complete core-facing contract implemented by one platform package. */
export interface PlatformSpec<Kinds extends readonly [string, ...string[]], Context extends BuildContext<Environment<Kinds[number]>>> {
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
    project?(input: ArtifactProjectionInput<Kinds[number]>): readonly ComponentArtifact[];
    /** Platform-intrinsic checks only; organization policy is renderer input. */
    readonly validators?: readonly WorldValidator<Kinds[number]>[];
}
/** A runtime output schema carrying its inferred TypeScript value. */
export interface Schema<T> {
    readonly [schemaTypeBrand]?: T;
    readonly [schemaSymbol]: SchemaData;
}
/** A schema for arbitrary strings. */
export type StringSchema = Schema<string> & {
    readonly kind: "string";
};
/** A schema for absolute HTTP or HTTPS URLs. */
export type UrlSchema = Schema<string> & {
    readonly kind: "url";
};
/** A schema for finite numbers. */
export type NumberSchema = Schema<number> & {
    readonly kind: "number";
};
/** Named child schemas accepted by an object schema. */
export type SchemaShape = {
    readonly [key: string]: Schema<unknown>;
};
/** A schema for one named object shape. */
export interface ObjectSchema<Shape extends SchemaShape> extends Schema<{
    readonly [Key in keyof Shape]: InferSchema<Shape[Key]>;
}> {
    readonly kind: "object";
    readonly shape: Shape;
}
/** Infers the concrete value represented by a schema. */
export type InferSchema<S extends Schema<unknown>> = S extends Schema<infer Value> ? Value : never;
/** Infers the concrete object represented by a schema shape. */
export type InferShape<Shape extends SchemaShape> = {
    readonly [Key in keyof Shape]: InferSchema<Shape[Key]>;
};
/** Maps a value to its pre-resolution shape with typed refs at any leaf. */
export type BuildValue<T> = Ref<T> | (T extends string | number | boolean | null ? T : T extends readonly unknown[] ? {
    readonly [Key in keyof T]: BuildValue<T[Key]>;
} : T extends object ? {
    readonly [Key in keyof T]: BuildValue<T[Key]>;
} : T);
/** Maps an output schema to the component module's public ref object. */
export type RefObject<S extends Schema<unknown>> = S extends ObjectSchema<infer Shape> ? {
    readonly [Key in keyof Shape]: RefObjectForChild<Shape[Key]>;
} : Ref<InferSchema<S>>;
type RefObjectForChild<S extends Schema<unknown>> = S extends ObjectSchema<SchemaShape> ? RefObject<S> : Ref<InferSchema<S>>;
/** Every environment row required by a platform, including preview. */
export type ParamsByEnvironment<StableKind extends string> = {
    readonly [Kind in StableKind | "preview"]: object;
};
/** Named homogeneous parameter-table annotation for platform re-exports. */
export type ParamsTable<StableKind extends string, Row extends object> = {
    readonly [Kind in StableKind | "preview"]: Row;
};
/** Rejects rows outside a platform's stable kinds plus preview. */
export type ExactParams<StableKind extends string, Rows extends ParamsByEnvironment<StableKind>> = Rows & {
    readonly [Extra in Exclude<keyof Rows, StableKind | "preview">]: never;
};
/** Component author specification with an exhaustive exact params table. */
export interface ComponentSpecWithParams<StableKind extends string, Context, Output extends ObjectSchema<SchemaShape>, Rows extends ParamsByEnvironment<StableKind>> {
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
    readonly build: (ctx: Context, params: Rows[StableKind | "preview"]) => BuildValue<InferSchema<Output>>;
}
/** Component author specification whose build has no params argument. */
export interface ComponentSpecWithoutParams<StableKind extends string, Context, Output extends ObjectSchema<SchemaShape>> {
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
export interface ComponentDefinition<Output extends ObjectSchema<SchemaShape>, StableKind extends string = string> {
    /** Static output contract. */
    readonly outputs: Output;
    /** Optional preview borrowing target selected by the component. */
    readonly borrowForPreview?: StableKind;
    readonly [componentRuntimeSymbol]: ComponentRuntime;
}
/** Default component-package export: output refs plus a symbol definition. */
export type ComponentModule<Output extends ObjectSchema<SchemaShape>> = RefObject<Output> & {
    readonly [componentDefinitionSymbol]: ComponentDefinition<Output>;
};
/** Fully platform-bound component definition helper. */
export interface DefineComponent<StableKind extends string, Context> {
    /** Defines a component with an exact exhaustive params table. */
    <Shape extends SchemaShape, Rows extends ParamsByEnvironment<StableKind>>(spec: ComponentSpecWithParams<StableKind, Context, ObjectSchema<Shape>, Rows>): ComponentModule<ObjectSchema<Shape>>;
    /** Defines a component with no params table. */
    <Shape extends SchemaShape>(spec: ComponentSpecWithoutParams<StableKind, Context, ObjectSchema<Shape>>): ComponentModule<ObjectSchema<Shape>>;
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
    /** Defines an HTTP/HTTPS URL schema. */
    url(): UrlSchema;
    /** Defines a finite number schema. */
    number(): NumberSchema;
}
/** Constructors for Henosis output schemas. */
export declare const h: SchemaBuilder;
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
    readonly components: Readonly<Record<string, RenderedWorldComponent<StableKind>>>;
}
/** Stable core-owned pipeline stages used by worker and gate diagnostics. */
export type PipelineStage = "platform-discovery" | "environment-validation" | "create-context" | "build" | "pending-output-validation" | "finish-records" | "dispose" | "resolution" | "resolved-output-validation" | "validator" | "world-validation" | "projection" | "artifact-validation";
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
export declare class PipelineError extends Error {
    readonly failure: PipelineFailure;
    /** Creates a pipeline error from its stable serialized failure. */
    constructor(failure: PipelineFailure);
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
    readonly createContext: (input: PlatformContextInput<string>) => unknown;
    readonly finishRecords?: (ctx: unknown, records: RecordSink) => void;
    readonly dispose?: (ctx: unknown, outcome: ContextOutcome) => void;
    readonly project?: (input: ArtifactProjectionInput<string>) => readonly ComponentArtifact[];
    readonly validators: readonly WorldValidator<string>[];
}
interface SchemaData {
    readonly kind: "string" | "url" | "number" | "object";
    readonly shape?: SchemaShape;
}
interface OutputRefData {
    readonly source: ComponentDefinition<ObjectSchema<SchemaShape>>;
    readonly path: readonly string[];
}
/**
 * Binds a frozen platform descriptor and returns its sole author-facing helper.
 */
export declare function definePlatform<const Kinds extends readonly [string, ...string[]], Context extends BuildContext<Environment<Kinds[number]>>>(spec: PlatformSpec<Kinds, Context>): PlatformBinding<Kinds[number], Context>;
/** Gets the immutable definition stored behind a component's well-known symbol. */
export declare function getComponentDefinition<Output extends ObjectSchema<SchemaShape>>(component: ComponentModule<Output>): ComponentDefinition<Output>;
/** Tests whether a value is a Henosis component default export. */
export declare function isComponentModule(value: unknown): value is ComponentModule<ObjectSchema<SchemaShape>>;
/** Tests whether a value is a symbolic Henosis output ref. */
export declare function isRef(value: unknown): value is Ref<unknown>;
/** Gets the immutable producer definition carried by a symbolic ref. */
export declare function refSourceDefinition(value: Ref<unknown>): ComponentDefinition<ObjectSchema<SchemaShape>>;
/** Gets the output path carried by a symbolic ref. */
export declare function refOutputPath(value: Ref<unknown>): readonly string[];
/**
 * Discovers and verifies a world's one platform descriptor from defaults only.
 */
export declare function inspectWorldPlatform(components: readonly ImportedComponent[]): ComponentPlatformInfo;
/**
 * Evaluates, resolves, validates, and projects one world with no partial result.
 */
export declare function evaluateWorld<StableKind extends string>(plan: WorldPlan<StableKind>): RenderResult<StableKind>;
/** One success or failure cell returned by the in-process widened-gate harness. */
export type GateWorldResult<StableKind extends string> = {
    readonly environment: Environment<StableKind>;
    readonly ok: true;
    readonly result: RenderResult<StableKind>;
} | {
    readonly environment: Environment<StableKind>;
    readonly ok: false;
    readonly failure: PipelineFailure;
};
/**
 * Runs every discovered stable kind plus the fixed representative preview.
 * The preview uses the supplied changed set, so unchanged eligible components
 * can borrow while changed members and reverse-dependants always materialize.
 */
export declare function evaluateGateWorlds<StableKind extends string>(opts: {
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
}): readonly GateWorldResult<StableKind>[];
/**
 * Resolves all outputs and record trees in one definition-identity world pass.
 * This function is the sole public constructor of branded resolved records.
 */
export declare function resolvePendingWorld(pending: PendingWorldForResolution): ResolvedPendingWorld;
/** Runs intrinsic then policy validators and returns every ordered issue. */
export declare function runWorldValidators<StableKind extends string>(world: ResolvedWorld<StableKind>, platformValidators: readonly WorldValidator<StableKind>[], policyValidators: readonly WorldValidator<StableKind>[]): readonly ReportedValidationIssue[];
/** Validates a value against an introspectable Henosis output schema. */
export declare function validateSchema<SchemaType extends Schema<unknown>>(schema: SchemaType, value: unknown, opts?: ValidationOptions): OutputValidationIssue[];
/** Validates, duplicate-checks, and code-unit sorts projected artifacts. */
export declare function validateAndSortArtifacts(artifacts: readonly ComponentArtifact[]): readonly ComponentArtifact[];
/** Code-unit comparison, deterministic across locale and ICU versions. */
export declare function compareCodeUnits(left: string, right: string): number;
/** Formats one canonical stable or preview environment identity. */
export declare function formatEnvironment<StableKind extends string>(env: Environment<StableKind>): string;
/** Parses the strict stable/TypeID grammar with a marked legacy-preview shim. */
export declare function parseEnvironmentName<StableKind extends string>(stableKinds: readonly StableKind[], name: string): Environment<StableKind>;
/** Validates a programmatic environment against a discovered platform. */
export declare function assertSupportedEnvironment(stableKinds: readonly string[], env: Environment<string>): void;
/**
 * Encodes a UUID as a Henosis environment id in canonical TypeID format.
 *
 * Henosis environments always carry a non-empty prefix, so the general
 * TypeID empty-prefix form is deliberately rejected by this helper.
 */
export declare function typeIdFromUuid(prefix: string, uuid: string): string;
/**
 * Decodes a canonical Henosis environment id and returns its lowercase UUID.
 *
 * The general TypeID empty-prefix form is intentionally unsupported because
 * Henosis environment identities always have a non-empty type prefix.
 */
export declare function uuidFromTypeId(typeId: string, expectedPrefix?: string): string;
/**
 * Tests the temporary legacy `preview-...` compatibility grammar.
 *
 * LIVE-V1-COMPAT: delete when the bot emits TypeIDs and no active manifest
 * contains a legacy preview identity.
 */
export declare function isLegacyPreviewEnvironmentName(name: string): boolean;
export {};
//# sourceMappingURL=index.d.ts.map