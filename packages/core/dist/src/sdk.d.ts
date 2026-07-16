export type JsonValue = null | boolean | number | string | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
declare const schemaSymbol: unique symbol;
declare const schemaValue: unique symbol;
export type SchemaWire = {
    readonly kind: "string" | "url" | "number" | "boolean" | "json" | "artifact";
} | {
    readonly kind: "array";
    readonly element: SchemaWire;
} | {
    readonly kind: "object";
    readonly fields: Readonly<Record<string, SchemaWire>>;
};
export interface Schema<Value> {
    readonly kind: SchemaWire["kind"];
    readonly [schemaValue]?: Value;
    readonly [schemaSymbol]: SchemaWire;
    default(value: Value): ConfigDeclaration<Value>;
}
export interface ConfigDeclaration<Value> {
    readonly schema: Schema<Value>;
    readonly default: Value;
}
export type InferSchema<S extends Schema<unknown>> = S extends Schema<infer Value> ? Value : never;
export type SchemaFields = Readonly<Record<string, Schema<unknown>>>;
export type ConfigDeclarations = Readonly<Record<string, Schema<unknown> | ConfigDeclaration<unknown>>>;
export declare const value: Readonly<{
    string: () => Schema<string>;
    url: () => Schema<string>;
    number: () => Schema<number>;
    boolean: () => Schema<boolean>;
    json: () => Schema<JsonValue>;
    array: <Element extends Schema<unknown>>(element: Element) => Schema<readonly InferSchema<Element>[]>;
    object: <const Fields extends SchemaFields>(fields: Fields) => Schema<{ readonly [Key in keyof Fields]: InferSchema<Fields[Key]>; }>;
}>;
export declare function schemaWire(schema: Schema<unknown>): SchemaWire;
export type OutputAvailability = "static" | "observed";
export interface OutputDeclaration<Value, Optional extends boolean = false, Availability extends OutputAvailability = OutputAvailability> {
    readonly availability: Availability;
    readonly schema: Schema<Value>;
    readonly optional: Optional;
}
export type OutputDeclarations = Readonly<Record<string, OutputDeclaration<unknown, boolean, OutputAvailability>>>;
export declare const output: Readonly<{
    static<Value>(schema: Schema<Value>): OutputDeclaration<Value, false, "static">;
    optionalStatic<Value>(schema: Schema<Value>): OutputDeclaration<Value, true, "static">;
    observed<Value>(schema: Schema<Value>): OutputDeclaration<Value, false, "observed">;
    optionalObserved<Value>(schema: Schema<Value>): OutputDeclaration<Value, true, "observed">;
}>;
declare const componentSymbol: unique symbol;
declare const outputHandleSymbol: unique symbol;
declare const bindingSymbol: unique symbol;
declare const outputValue: unique symbol;
export type OutputHandle<Value, Optional extends boolean = false> = {
    readonly component: string;
    readonly output: string;
    readonly optional: Optional;
    readonly schema: Schema<Value>;
    readonly value: Value;
    readonly [outputValue]?: Value;
    readonly [outputHandleSymbol]: true;
} & (Optional extends true ? {
    readonly present: boolean;
} : object);
export type ComponentOutputs<Declarations extends OutputDeclarations> = {
    readonly [Key in keyof Declarations]: Declarations[Key] extends OutputDeclaration<infer Value, infer Optional> ? OutputHandle<Value, Optional> : never;
};
export interface InputValue<Value> {
    readonly value: Value;
}
export type BuildConfig<Declarations extends ConfigDeclarations> = {
    readonly [Key in keyof Declarations]: Declarations[Key] extends ConfigDeclaration<infer Value> ? InputValue<Value> : Declarations[Key] extends Schema<infer Value> ? InputValue<Value> : never;
};
export type ArtifactDigest = `sha256:${string}`;
export interface ConfigFileDeclaration {
    readonly path: string;
    /** Optional author assertion. The bundler always computes the closure digest. */
    readonly sha256?: ArtifactDigest;
}
export interface ClosureFile {
    readonly path: string;
    readonly sha256: ArtifactDigest;
}
export declare const config: Readonly<{
    file(path: string, sha256?: ArtifactDigest): ConfigFileDeclaration;
}>;
export interface ConfigFileField {
    /** RFC 6901-like path to each object containing a configuration-file reference. */
    readonly references: string;
    readonly pathField: string;
    readonly digestField: string;
}
export interface ResourceIntent<Outputs extends OutputDeclarations> {
    readonly kind: string;
    readonly name: string;
    readonly body: unknown;
    readonly outputs: Outputs;
    readonly configFiles: readonly ConfigFileField[];
}
export interface ResourceDefinition<Body extends object, Outputs extends OutputDeclarations> {
    readonly kind: string;
    readonly outputs: Outputs;
    readonly configFiles: readonly ConfigFileField[];
    create(name: string, body: Body): ResourceIntent<Outputs>;
}
export interface ObservedOutputBinding<Value> {
    readonly resource: string;
    readonly output: string;
    readonly [bindingSymbol]: Value;
}
export interface EmittedResource<Outputs extends OutputDeclarations> {
    readonly address: string;
    readonly outputs: {
        readonly [Key in keyof Outputs]: Outputs[Key] extends OutputDeclaration<infer Value> ? ObservedOutputBinding<Value> : never;
    };
}
export declare function defineResource<Body extends object, const Outputs extends OutputDeclarations>(spec: {
    readonly kind: string;
    readonly outputs: Outputs;
    readonly configFiles?: readonly ConfigFileField[];
}): ResourceDefinition<Body, Outputs>;
export interface ResourceEmission {
    readonly address: string;
    readonly kind: string;
    readonly name: string;
    readonly body: JsonValue;
    readonly canonical: string;
}
export interface BuildContext<Config extends ConfigDeclarations = Record<never, never>> {
    readonly config: BuildConfig<Config>;
    emit<Outputs extends OutputDeclarations>(intent: ResourceIntent<Outputs>): EmittedResource<Outputs>;
}
export type BuildOutputs<Declarations extends OutputDeclarations> = {
    readonly [Key in keyof Declarations]: Declarations[Key] extends OutputDeclaration<infer Value, infer Optional, infer Availability> ? Availability extends "observed" ? Optional extends true ? ObservedOutputBinding<Value> | undefined : ObservedOutputBinding<Value> : Optional extends true ? Value | undefined : Value : never;
};
export interface ComponentSpec<Config extends ConfigDeclarations, Outputs extends OutputDeclarations> {
    readonly name: string;
    readonly config?: Config;
    /** Configuration content carried in the hermetic evaluation closure. */
    readonly files?: readonly ConfigFileDeclaration[];
    readonly outputs: Outputs;
    readonly build: (context: BuildContext<Config>) => BuildOutputs<Outputs>;
}
export interface ComponentDefinition<Config extends ConfigDeclarations = ConfigDeclarations, Outputs extends OutputDeclarations = OutputDeclarations> {
    readonly protocolVersion: 1;
    readonly name: string;
    readonly config: Config;
    readonly files: readonly ConfigFileDeclaration[];
    readonly outputs: Outputs;
    readonly build: ComponentSpec<Config, Outputs>["build"];
}
export interface ComponentModule<Config extends ConfigDeclarations, Outputs extends OutputDeclarations> {
    readonly name: string;
    readonly outputs: ComponentOutputs<Outputs>;
    readonly [componentSymbol]: ComponentDefinition<Config, Outputs>;
}
export declare function defineComponent<const Config extends ConfigDeclarations = Record<never, never>, const Outputs extends OutputDeclarations = OutputDeclarations>(spec: ComponentSpec<Config, Outputs>): ComponentModule<Config, Outputs>;
export declare function getComponentDefinition<Config extends ConfigDeclarations, Outputs extends OutputDeclarations>(component: ComponentModule<Config, Outputs>): ComponentDefinition<Config, Outputs>;
export type ArtifactKind = "cloudflare-worker" | "static-assets";
export interface ArtifactInputSource {
    readonly source: "artifact";
    readonly kind: ArtifactKind;
    readonly path: string;
}
export type BundleInputSource = OutputHandle<unknown, boolean> | ArtifactInputSource;
export type BundleInputSources = Readonly<Record<string, BundleInputSource>>;
export type InputSnapshotCell = {
    readonly state: "available";
    readonly value: JsonValue;
} | {
    readonly state: "blocked";
} | {
    readonly state: "absent";
};
export interface EvaluationSnapshot {
    readonly protocolVersion: 1;
    readonly inputs: Readonly<Record<string, InputSnapshotCell>>;
}
export interface OutputBindingWire {
    readonly resource: string;
    readonly output: string;
}
export type InputMetadataWire = {
    readonly component: string;
    readonly output: string;
    readonly optional: boolean;
} | {
    readonly source: "config";
    readonly schema: SchemaWire;
    readonly default?: {
        readonly value: JsonValue;
    };
};
export interface OutputMetadataWire {
    readonly availability: OutputAvailability;
    readonly optional: boolean;
    readonly schema: SchemaWire;
}
export interface ComponentMetadataWire {
    readonly name: string;
    readonly inputs: Readonly<Record<string, InputMetadataWire>>;
    readonly outputs: Readonly<Record<string, OutputMetadataWire>>;
    readonly files: readonly ClosureFile[];
}
export interface EvaluationSuccess {
    readonly protocolVersion: 1;
    readonly status: "complete";
    readonly resources: readonly ResourceEmission[];
    readonly outputs: Readonly<Record<string, JsonValue>>;
    readonly observedOutputs: Readonly<Record<string, OutputBindingWire>>;
    readonly reads: readonly string[];
}
export interface EvaluationBlocked {
    readonly protocolVersion: 1;
    readonly status: "blocked";
    readonly resources: readonly ResourceEmission[];
    readonly blocked: BlockedWire;
    readonly reads: readonly string[];
}
export type EvaluationResult = EvaluationSuccess | EvaluationBlocked;
export interface BundleModule {
    readonly protocolVersion: 1;
    readonly component: ComponentMetadataWire;
    evaluate(snapshot: EvaluationSnapshot): EvaluationResult;
}
export declare function createBundle<Config extends ConfigDeclarations, Outputs extends OutputDeclarations>(component: ComponentModule<Config, Outputs>, closureFiles?: readonly ClosureFile[], derivedInputs?: BundleInputSources): BundleModule;
export declare function executeComponent<Config extends ConfigDeclarations, Outputs extends OutputDeclarations>(component: ComponentModule<Config, Outputs>, snapshot: EvaluationSnapshot, closureFiles?: readonly ClosureFile[], derivedInputs?: BundleInputSources): EvaluationResult;
export declare class AuthoringError extends Error {
    readonly code: string;
    readonly summary: string;
    readonly help: string;
    constructor(code: string, summary: string, help: string);
}
export interface HostBlockedDetail {
    readonly input: string;
    readonly source: string;
    readonly operation: string;
    readonly message: string;
}
export interface BlockedWire extends HostBlockedDetail {
    readonly code: "HENOSIS_BLOCKED";
}
export declare class Blocked extends Error {
    readonly input: string;
    readonly source: string;
    readonly operation: string;
    readonly code: "HENOSIS_BLOCKED";
    constructor(input: string, source: string, operation: string);
    toWire(): BlockedWire;
}
export declare function compareCodeUnits(left: string, right: string): number;
export declare function canonicalStringify(input: JsonValue): string;
export declare function canonicalize(input: JsonValue): JsonValue;
export {};
//# sourceMappingURL=sdk.d.ts.map