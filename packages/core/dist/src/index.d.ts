export declare const componentDefinitionSymbol: unique symbol;
declare const schemaSymbol: unique symbol;
declare const refSymbol: unique symbol;
declare const schemaTypeBrand: unique symbol;
declare const refTypeBrand: unique symbol;
export type StableEnvKind = "dev" | "staging" | "prod";
export type Env = {
    readonly kind: StableEnvKind;
} | {
    readonly kind: "preview";
    readonly id: string;
};
export type ImageRef = {
    readonly ref: string;
    readonly digest: string;
};
export type BuildContext = {
    readonly env: Env;
    readonly image: ImageRef;
};
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
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
export type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;
export type InferShape<Shape extends SchemaShape> = {
    readonly [K in keyof Shape]: InferSchema<Shape[K]>;
};
export type RefObject<S extends Schema<unknown>> = S extends ObjectSchema<infer Shape> ? {
    readonly [K in keyof Shape]: RefObjectForChild<Shape[K]>;
} : Ref<InferSchema<S>>;
type RefObjectForChild<S extends Schema<unknown>> = S extends ObjectSchema<SchemaShape> ? RefObject<S> : Ref<InferSchema<S>>;
export type BuildValue<T> = Ref<T> | (T extends string | number | boolean | null ? T : T extends readonly unknown[] ? {
    readonly [K in keyof T]: BuildValue<T[K]>;
} : T extends object ? {
    readonly [K in keyof T]: BuildValue<T[K]>;
} : T);
export type ComponentSpec<S extends ObjectSchema<SchemaShape>> = {
    readonly outputs: S;
    readonly build: (ctx: BuildContext, env: Env) => BuildValue<InferSchema<S>>;
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
export declare const h: {
    object<Shape extends SchemaShape>(shape: Shape): ObjectSchema<Shape>;
    string(): StringSchema;
    url(): UrlSchema;
};
export declare function envName(env: Env): string;
export declare function envFromName(name: string): Env;
export declare function defineComponent<Shape extends SchemaShape>(spec: ComponentSpec<ObjectSchema<Shape>>): ComponentModule<ObjectSchema<Shape>>;
export declare function getComponentDefinition<S extends ObjectSchema<SchemaShape>>(component: ComponentModule<S>): ComponentDefinition<S>;
export declare function isComponentModule(value: unknown): value is ComponentModule<ObjectSchema<SchemaShape>>;
export declare function bindComponentIdentity<S extends ObjectSchema<SchemaShape>>(component: ComponentModule<S>, componentName: string): void;
export declare function evaluateComponent<S extends ObjectSchema<SchemaShape>>(component: ComponentModule<S>, opts: EvaluationOptions): EvaluationResult<InferSchema<S>>;
export declare function validateSchema<S extends Schema<unknown>>(schema: S, value: unknown, opts?: ValidationOptions): ValidationIssue[];
export declare function isRef(value: unknown): value is Ref<unknown>;
export declare function refSourceComponent(value: Ref<unknown>): string | undefined;
export declare function refOutputPath(value: Ref<unknown>): readonly string[];
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
export {};
//# sourceMappingURL=index.d.ts.map