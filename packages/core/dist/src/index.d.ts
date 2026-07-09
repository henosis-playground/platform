/** The well-known property that stores a component's non-author-facing definition. */
export declare const componentDefinitionSymbol: unique symbol;
declare const componentRuntimeSymbol: unique symbol;
declare const schemaSymbol: unique symbol;
declare const refSymbol: unique symbol;
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
export type Env<Kind extends StableEnvKind = StableEnvKind> = {
    readonly kind: Kind;
} | {
    readonly kind: "preview";
    readonly id: string;
};
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
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
/** A structured platform record emitted while evaluating one component. */
export type ComponentRecord = {
    /** A platform-defined discriminator for the structured record. */
    readonly kind: string;
    /** The structured record payload. */
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
export type PlatformContextInput<Environment extends RuntimeEnv> = BuildContext<Environment> & ComponentWriters;
/** All records available to a platform world validator. */
export type WorldRecords<Environment extends RuntimeEnv = RuntimeEnv> = {
    /** The requesting world environment. */
    readonly env: Environment;
    /** Records grouped by manifest component identity. */
    readonly components: Readonly<Record<string, readonly ComponentRecord[]>>;
};
/** A platform-provided validation check over a rendered world's records. */
export type WorldValidator<Environment extends RuntimeEnv = RuntimeEnv> = (world: WorldRecords<Environment>) => void;
/**
 * The lifecycle a platform uses to create context and finish an evaluation.
 *
 * `createContext` runs before the component build. `finalize` runs after a
 * successful build and may emit records or artifacts through the writers.
 */
export type PlatformLifecycle<Environment extends RuntimeEnv, Context extends BuildContext<Environment>> = {
    /** Creates the fully typed platform context before build runs. */
    readonly createContext: (input: PlatformContextInput<Environment>) => Context;
    /** Finalizes the platform after a successful build returns. */
    readonly finalize: (ctx: Context, writers: ComponentWriters) => void;
    /** Optional record-only checks run once per rendered world. */
    readonly validators?: readonly WorldValidator<Environment>[];
};
/** The small core interface a platform implements. */
export type PlatformSpec<Kind extends StableEnvKind, Context extends BuildContext<Env<Kind>>> = PlatformLifecycle<Env<Kind>, Context> & {
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
export type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;
/** Infers the value object represented by a schema shape. */
export type InferShape<Shape extends SchemaShape> = {
    readonly [K in keyof Shape]: InferSchema<Shape[K]>;
};
/** Maps an output schema to the component module's symbolic ref object. */
export type RefObject<S extends Schema<unknown>> = S extends ObjectSchema<infer Shape> ? {
    readonly [K in keyof Shape]: RefObjectForChild<Shape[K]>;
} : Ref<InferSchema<S>>;
type RefObjectForChild<S extends Schema<unknown>> = S extends ObjectSchema<SchemaShape> ? RefObject<S> : Ref<InferSchema<S>>;
/** A build value, allowing typed refs anywhere a concrete value can appear. */
export type BuildValue<T> = Ref<T> | (T extends string | number | boolean | null ? T : T extends readonly unknown[] ? {
    readonly [K in keyof T]: BuildValue<T[K]>;
} : T extends object ? {
    readonly [K in keyof T]: BuildValue<T[K]>;
} : T);
/** Every environment row required by a platform, including one preview row. */
export type ParamsByEnv<Kind extends StableEnvKind, P> = {
    readonly [EnvironmentKind in Kind | "preview"]: P;
};
/** A component specification with an exhaustive platform params table. */
export type ComponentWithParamsSpec<S extends ObjectSchema<SchemaShape>, Kind extends StableEnvKind, Context extends BuildContext<Env<Kind>>, P> = {
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
export type ComponentWithoutParamsSpec<S extends ObjectSchema<SchemaShape>, Kind extends StableEnvKind, Context extends BuildContext<Env<Kind>>> = {
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
export interface PlatformDefineComponent<Kind extends StableEnvKind, Context extends BuildContext<Env<Kind>>> {
    /** Defines a component with an exhaustive environment params table. */
    <Shape extends SchemaShape, P>(spec: ComponentWithParamsSpec<ObjectSchema<Shape>, Kind, Context, P>): ComponentModule<ObjectSchema<Shape>>;
    /** Defines a component whose build needs no params table. */
    <Shape extends SchemaShape>(spec: ComponentWithoutParamsSpec<ObjectSchema<Shape>, Kind, Context>): ComponentModule<ObjectSchema<Shape>>;
}
/** The typed facade produced once a platform binds its core configuration. */
export type Platform<Kind extends StableEnvKind, Context extends BuildContext<Env<Kind>>> = {
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
export type EvaluationOptions<Environment extends RuntimeEnv = RuntimeEnv> = BuildContext<Environment> & ComponentWriters;
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
export declare const h: SchemaBuilder;
/** Formats a typed environment for manifest and output boundaries. */
export declare function envName(env: RuntimeEnv): string;
/** Parses an environment name using a platform's stable-kind set. */
export declare function envFromName<const Kind extends StableEnvKind>(name: string, stableEnvKinds: readonly Kind[]): Env<Kind>;
/** Binds a platform's env set, context lifecycle, writers, and validators. */
export declare function definePlatform<const Kind extends StableEnvKind, Context extends BuildContext<Env<Kind>>>(spec: PlatformSpec<Kind, Context>): Platform<Kind, Context>;
/** Gets the definition stored behind a component module's well-known symbol. */
export declare function getComponentDefinition<S extends ObjectSchema<SchemaShape>>(component: ComponentModule<S>): ComponentDefinition<S>;
/** Tests whether a value is a Henosis component default export. */
export declare function isComponentModule(value: unknown): value is ComponentModule<ObjectSchema<SchemaShape>>;
/** Assigns the manifest component identity used by symbolic output refs. */
export declare function bindComponentIdentity<S extends ObjectSchema<SchemaShape>>(component: ComponentModule<S>, componentName: string): void;
/** Runs one component through its platform lifecycle and build. */
export declare function evaluateComponent<S extends ObjectSchema<SchemaShape>, Environment extends RuntimeEnv>(component: ComponentModule<S>, opts: EvaluationOptions<Environment>): EvaluationResult<InferSchema<S>>;
/** Runs each distinct platform validator over the rendered world's records. */
export declare function runWorldValidators(components: readonly ComponentModule<ObjectSchema<SchemaShape>>[], world: WorldRecords): void;
/** Validates a value against an introspectable Henosis schema. */
export declare function validateSchema<S extends Schema<unknown>>(schema: S, value: unknown, opts?: ValidationOptions): ValidationIssue[];
/** Tests whether a value is a symbolic Henosis output ref. */
export declare function isRef(value: unknown): value is Ref<unknown>;
/** Gets the source component identity carried by a symbolic ref. */
export declare function refSourceComponent(value: Ref<unknown>): string | undefined;
/** Gets the output path carried by a symbolic ref. */
export declare function refOutputPath(value: Ref<unknown>): readonly string[];
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
export {};
//# sourceMappingURL=index.d.ts.map