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
export type StringSchema = Schema<string> & { readonly kind: "string" };

/** A schema for absolute HTTP or HTTPS URLs. */
export type UrlSchema = Schema<string> & { readonly kind: "url" };

/** A schema for a non-plaintext secret reference. */
export type SecretReferenceSchema = Schema<SecretReference> & {
  readonly kind: "secret-ref";
};

/** Named child schemas accepted by an object schema. */
export type SchemaShape = Readonly<Record<string, Schema<unknown>>>;

/** A schema for one named object shape. */
export interface ObjectSchema<Shape extends SchemaShape>
  extends Schema<unknown> {
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
export const h: SchemaBuilder = Object.freeze({
  object<Shape extends SchemaShape>(shape: Shape): ObjectSchema<Shape> {
    return Object.freeze({ kind: "object" as const, shape });
  },
  string(): StringSchema {
    return Object.freeze({ kind: "string" as const });
  },
  url(): UrlSchema {
    return Object.freeze({ kind: "url" as const });
  },
  secretRef(): SecretReferenceSchema {
    return Object.freeze({ kind: "secret-ref" as const });
  },
});

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
export type InputOutputSchema =
  | StringSchema
  | UrlSchema
  | SecretReferenceSchema;

/** Flat declared output contract for a referenced component. */
export type InputOutputShape = Readonly<Record<string, InputOutputSchema>>;

/** Typed output references derived from a declared producer contract. */
export type DeclaredOutputs<Shape extends InputOutputShape> = {
  readonly [Key in keyof Shape]: Shape[Key] extends UrlSchema
    ? OutputReference<string, "url">
    : Shape[Key] extends SecretReferenceSchema
      ? OutputReference<SecretReference, "secret">
      : OutputReference<string, "string">;
};

/** Anonymous PostgREST access implemented by the deployed connector. */
export type AnonAccess = "none" | "read";

/** JSON value accepted as a fallback for an absent producer output. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** One typed producer output with an optional connector-supported fallback. */
export type MigrationInput =
  | OutputReference<unknown, InputKind>
  | {
      readonly from: OutputReference<unknown, InputKind>;
      readonly default: JsonValue;
    };

/** Per-migration transaction-local settings sourced from typed outputs. */
export type MigrationInputs = Readonly<
  Record<string, Readonly<Record<string, MigrationInput>>>
>;

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
export const databaseOutputs = h.object({
  restUrl: h.url(),
  schema: h.string(),
  anonKeyRef: h.secretRef(),
});

/** Declares another component's output contract and returns typed refs. */
export function declareOutputs<Shape extends InputOutputShape>(
  component: string,
  outputs: ObjectSchema<Shape>,
): DeclaredOutputs<Shape> {
  assertComponentName(component);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(outputs.shape).map(([output, schema]) => [
        output,
        reference(inputKind(schema), component, output),
      ]),
    ),
  ) as DeclaredOutputs<Shape>;
}

/** Defines one immutable Supabase database for separate repository execution. */
export function defineDatabase<const Inputs extends MigrationInputs = MigrationInputs>(
  spec: DatabaseSpec<Inputs>,
): DatabaseDefinition<Inputs> {
  if (spec.outputs !== databaseOutputs) {
    throw new Error("Supabase databases must publish databaseOutputs");
  }
  assertMigrationsDir(spec.migrationsDir);
  assertSchema(spec.schema);
  assertMigrationInputs(spec.migrationInputs);
  return Object.freeze({
    kind: "supabase.database" as const,
    outputs: spec.outputs,
    migrationsDir: spec.migrationsDir,
    schema: spec.schema,
    api: Object.freeze({ ...spec.api }),
    ...(spec.migrationInputs === undefined
      ? {}
      : { migrationInputs: freezeMigrationInputs(spec.migrationInputs) }),
    environments: ["dev", "prod", "preview"] as const,
  });
}

function inputKind(schema: InputOutputSchema): InputKind {
  if (schema.kind === "url") return "url";
  if (schema.kind === "secret-ref") return "secret";
  return "string";
}

function reference<Kind extends InputKind>(
  kind: Kind,
  component: string,
  output: string,
): OutputReference<unknown, Kind> {
  if (output.length === 0) throw new Error("Output name must not be empty");
  return Object.freeze({ kind, component, output });
}

function assertMigrationsDir(value: string): void {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("migrationsDir must be a repository-relative path without parent traversal");
  }
}

function assertSchema(value: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value)) {
    throw new Error("schema must match [a-z][a-z0-9_]{0,62}");
  }
}

function assertMigrationInputs(inputs: MigrationInputs | undefined): void {
  for (const [migration, values] of Object.entries(inputs ?? {})) {
    if (!/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(migration)) {
      throw new Error(`Invalid migration id ${JSON.stringify(migration)}`);
    }
    for (const [name, value] of Object.entries(values)) {
      if (!/^[a-z][a-z0-9_]{0,62}$/u.test(name)) {
        throw new Error(`Invalid migration input name ${JSON.stringify(name)}`);
      }
      const output = "from" in value ? value.from : value;
      assertComponentName(output.component);
      if (output.output.length === 0) throw new Error("Output name must not be empty");
    }
  }
}

function freezeMigrationInputs<Inputs extends MigrationInputs>(inputs: Inputs): Inputs {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(inputs).map(([migration, values]) => [
        migration,
        Object.freeze({ ...values }),
      ]),
    ),
  ) as Inputs;
}

function assertComponentName(component: string): void {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(component)) {
    throw new Error(`Invalid component name ${JSON.stringify(component)}`);
  }
}
