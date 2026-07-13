declare const schemaTypeBrand: unique symbol;
declare const secretReferenceBrand: unique symbol;
/** A reference to secret material held at the trusted target boundary. */
export type SecretReference = string & {
    readonly [secretReferenceBrand]: "secret-reference";
};
/** A runtime output schema carrying its inferred TypeScript value. */
export interface Schema<Value> {
    readonly [schemaTypeBrand]?: Value;
}
/** A schema for arbitrary strings. */
export type StringSchema = Schema<string> & {
    readonly kind: "string";
};
/** A schema for absolute HTTP or HTTPS URLs. */
export type UrlSchema = Schema<string> & {
    readonly kind: "url";
};
/** A schema for a non-plaintext secret reference. */
export type SecretReferenceSchema = Schema<SecretReference> & {
    readonly kind: "secret-ref";
};
/** Named child schemas accepted by an object schema. */
export type SchemaShape = Readonly<Record<string, Schema<unknown>>>;
/** A schema for one named object shape. */
export interface ObjectSchema<Shape extends SchemaShape> extends Schema<unknown> {
    readonly kind: "object";
    readonly shape: Shape;
}
/** Public output-schema construction vocabulary. */
export interface SchemaBuilder {
    object<Shape extends SchemaShape>(shape: Shape): ObjectSchema<Shape>;
    string(): StringSchema;
    url(): UrlSchema;
    secretRef(): SecretReferenceSchema;
}
/** Constructors for Supabase component output contracts. */
export declare const h: SchemaBuilder;
/** Input treatment derived from the producer output schema. */
export type InputKind = "string" | "url" | "secret";
/** A typed reference to one declared output of another component. */
export interface OutputReference<Value, Kind extends InputKind> {
    readonly kind: Kind;
    readonly component: string;
    readonly output: string;
    readonly __value?: Value;
}
/** Output schemas that can feed a migration input setting. */
export type InputOutputSchema = StringSchema | UrlSchema | SecretReferenceSchema;
/** Flat declared output contract for a referenced component. */
export type InputOutputShape = Readonly<Record<string, InputOutputSchema>>;
/** Typed output references derived from a declared producer contract. */
export type DeclaredOutputs<Shape extends InputOutputShape> = {
    readonly [Key in keyof Shape]: Shape[Key] extends UrlSchema ? OutputReference<string, "url"> : Shape[Key] extends SecretReferenceSchema ? OutputReference<SecretReference, "secret"> : OutputReference<string, "string">;
};
/** Anonymous PostgREST access implemented by the deployed connector. */
export type AnonAccess = "none" | "read";
/** Per-migration transaction-local settings sourced from typed outputs. */
export type MigrationInputs = Readonly<Record<string, Readonly<Record<string, OutputReference<unknown, InputKind>>>>>;
/** Author-facing database definition. */
export interface DatabaseSpec<Inputs extends MigrationInputs> {
    /** Connector-owned outputs published after successful reconciliation. */
    readonly outputs: typeof databaseOutputs;
    /** Repository-relative directory containing native SQL migrations. */
    readonly migrationsDir: string;
    /** Stable connector-owned PostgreSQL schema and resource identity. */
    readonly schema: string;
    /** PostgREST exposure and anonymous grant policy. */
    readonly api: {
        readonly expose: boolean;
        readonly anonAccess: AnonAccess;
    };
    /** Optional typed values exposed to individual migrations. */
    readonly migrationInputs?: Inputs;
}
/** Serializable definition consumed by Henosis inspection. */
export interface DatabaseDefinition<Inputs extends MigrationInputs> {
    readonly kind: "supabase.database";
    readonly outputs: typeof databaseOutputs;
    readonly migrationsDir: string;
    readonly schema: string;
    readonly api: {
        readonly expose: boolean;
        readonly anonAccess: AnonAccess;
    };
    readonly migrationInputs?: Inputs;
    readonly environments: readonly ["dev", "prod", "preview"];
}
/** Fixed public outputs used by the current Supabase connector subset. */
export declare const databaseOutputs: ObjectSchema<{
    restUrl: UrlSchema;
    schema: StringSchema;
    anonKeyRef: SecretReferenceSchema;
}>;
/** Declares another component's output contract and returns typed refs. */
export declare function declareOutputs<Shape extends InputOutputShape>(component: string, outputs: ObjectSchema<Shape>): DeclaredOutputs<Shape>;
/** Defines one immutable Supabase database for separate repository execution. */
export declare function defineDatabase<const Inputs extends MigrationInputs = MigrationInputs>(spec: DatabaseSpec<Inputs>): DatabaseDefinition<Inputs>;
export {};
//# sourceMappingURL=index.d.ts.map