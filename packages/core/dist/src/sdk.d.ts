export type JsonValue = null | boolean | number | string | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
declare const schemaSymbol: unique symbol;
declare const schemaValue: unique symbol;
export type SchemaWire = {
    readonly kind: "string" | "url" | "number" | "boolean" | "json";
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
}
export type InferSchema<S extends Schema<unknown>> = S extends Schema<infer Value> ? Value : never;
export type SchemaFields = Readonly<Record<string, Schema<unknown>>>;
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
export interface OutputHandle<Value, Optional extends boolean = false> {
    readonly component: string;
    readonly output: string;
    readonly optional: Optional;
    readonly [outputValue]?: Value;
    readonly [outputHandleSymbol]: true;
}
export type ComponentOutputs<Declarations extends OutputDeclarations> = {
    readonly [Key in keyof Declarations]: Declarations[Key] extends OutputDeclaration<infer Value, infer Optional> ? OutputHandle<Value, Optional> : never;
};
export interface OutputInputDeclaration<Value, Optional extends boolean = false> {
    readonly kind: "output";
    readonly source: OutputHandle<Value, boolean>;
    readonly optional: Optional;
}
export interface ConfigInputDeclaration<Value> {
    readonly kind: "config";
    readonly schema: Schema<Value>;
    readonly optional: false;
    readonly default?: Value;
}
export type InputDeclaration<Value, Optional extends boolean = false> = OutputInputDeclaration<Value, Optional> | ConfigInputDeclaration<Value>;
export type InputDeclarations = Readonly<Record<string, InputDeclaration<unknown, boolean>>>;
export declare const input: Readonly<{
    required<Value>(source: OutputHandle<Value, boolean>): OutputInputDeclaration<Value, false>;
    optional<Value>(source: OutputHandle<Value, true>): OutputInputDeclaration<Value, true>;
    config<Value>(schema: Schema<Value>, options?: {
        readonly default?: Value;
    }): ConfigInputDeclaration<Value>;
}>;
export interface InputValue<Value> {
    readonly value: Value;
}
export interface OptionalInputValue<Value> extends InputValue<Value> {
    readonly present: boolean;
}
export type BuildInputs<Declarations extends InputDeclarations> = {
    readonly [Key in keyof Declarations]: Declarations[Key] extends InputDeclaration<infer Value, infer Optional> ? Optional extends true ? OptionalInputValue<Value> : InputValue<Value> : never;
};
export interface ResourceIntent<Outputs extends OutputDeclarations> {
    readonly kind: string;
    readonly name: string;
    readonly body: unknown;
    readonly outputs: Outputs;
}
export interface ResourceDefinition<Body extends object, Outputs extends OutputDeclarations> {
    readonly kind: string;
    readonly outputs: Outputs;
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
}): ResourceDefinition<Body, Outputs>;
export interface ResourceEmission {
    readonly address: string;
    readonly kind: string;
    readonly name: string;
    readonly body: JsonValue;
    readonly canonical: string;
}
export interface BuildContext {
    emit<Outputs extends OutputDeclarations>(intent: ResourceIntent<Outputs>): EmittedResource<Outputs>;
}
export type BuildOutputs<Declarations extends OutputDeclarations> = {
    readonly [Key in keyof Declarations]: Declarations[Key] extends OutputDeclaration<infer Value, infer Optional, infer Availability> ? Availability extends "observed" ? Optional extends true ? ObservedOutputBinding<Value> | undefined : ObservedOutputBinding<Value> : Optional extends true ? Value | undefined : Value : never;
};
export interface ComponentSpec<Inputs extends InputDeclarations, Outputs extends OutputDeclarations> {
    readonly name: string;
    readonly inputs?: Inputs;
    readonly outputs: Outputs;
    readonly build: (context: BuildContext, inputs: BuildInputs<Inputs>) => BuildOutputs<Outputs>;
}
export interface ComponentDefinition<Inputs extends InputDeclarations = InputDeclarations, Outputs extends OutputDeclarations = OutputDeclarations> {
    readonly protocolVersion: 1;
    readonly name: string;
    readonly inputs: Inputs;
    readonly outputs: Outputs;
    readonly build: ComponentSpec<Inputs, Outputs>["build"];
}
export interface ComponentModule<Inputs extends InputDeclarations, Outputs extends OutputDeclarations> {
    readonly name: string;
    readonly outputs: ComponentOutputs<Outputs>;
    readonly [componentSymbol]: ComponentDefinition<Inputs, Outputs>;
}
export declare function defineComponent<const Inputs extends InputDeclarations = Record<never, never>, const Outputs extends OutputDeclarations = OutputDeclarations>(spec: ComponentSpec<Inputs, Outputs>): ComponentModule<Inputs, Outputs>;
export declare function getComponentDefinition<Inputs extends InputDeclarations, Outputs extends OutputDeclarations>(component: ComponentModule<Inputs, Outputs>): ComponentDefinition<Inputs, Outputs>;
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
export declare function createBundle<Inputs extends InputDeclarations, Outputs extends OutputDeclarations>(component: ComponentModule<Inputs, Outputs>): BundleModule;
export declare function executeComponent<Inputs extends InputDeclarations, Outputs extends OutputDeclarations>(component: ComponentModule<Inputs, Outputs>, snapshot: EvaluationSnapshot): EvaluationResult;
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