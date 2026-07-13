/** Constructors for Supabase component output contracts. */
export const h = Object.freeze({
    object(shape) {
        return Object.freeze({ kind: "object", shape });
    },
    string() {
        return Object.freeze({ kind: "string" });
    },
    url() {
        return Object.freeze({ kind: "url" });
    },
    secretRef() {
        return Object.freeze({ kind: "secret-ref" });
    },
});
/** Fixed public outputs used by the current Supabase connector subset. */
export const databaseOutputs = h.object({
    restUrl: h.url(),
    schema: h.string(),
    anonKeyRef: h.secretRef(),
});
/** Declares another component's output contract and returns typed refs. */
export function declareOutputs(component, outputs) {
    assertComponentName(component);
    return Object.freeze(Object.fromEntries(Object.entries(outputs.shape).map(([output, schema]) => [
        output,
        reference(inputKind(schema), component, output),
    ])));
}
/** Defines one immutable Supabase database for separate repository execution. */
export function defineDatabase(spec) {
    if (spec.outputs !== databaseOutputs) {
        throw new Error("Supabase databases must publish databaseOutputs");
    }
    assertMigrationsDir(spec.migrationsDir);
    assertSchema(spec.schema);
    assertMigrationInputs(spec.migrationInputs);
    return Object.freeze({
        kind: "supabase.database",
        outputs: spec.outputs,
        migrationsDir: spec.migrationsDir,
        schema: spec.schema,
        api: Object.freeze({ ...spec.api }),
        ...(spec.migrationInputs === undefined
            ? {}
            : { migrationInputs: freezeMigrationInputs(spec.migrationInputs) }),
        environments: ["dev", "prod", "preview"],
    });
}
function inputKind(schema) {
    if (schema.kind === "url")
        return "url";
    if (schema.kind === "secret-ref")
        return "secret";
    return "string";
}
function reference(kind, component, output) {
    if (output.length === 0)
        throw new Error("Output name must not be empty");
    return Object.freeze({ kind, component, output });
}
function assertMigrationsDir(value) {
    if (value.length === 0 ||
        value.startsWith("/") ||
        value.split(/[\\/]/u).includes("..")) {
        throw new Error("migrationsDir must be a repository-relative path without parent traversal");
    }
}
function assertSchema(value) {
    if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value)) {
        throw new Error("schema must match [a-z][a-z0-9_]{0,62}");
    }
}
function assertMigrationInputs(inputs) {
    for (const [migration, values] of Object.entries(inputs ?? {})) {
        if (!/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(migration)) {
            throw new Error(`Invalid migration id ${JSON.stringify(migration)}`);
        }
        for (const [name, value] of Object.entries(values)) {
            if (!/^[a-z][a-z0-9_]{0,62}$/u.test(name)) {
                throw new Error(`Invalid migration input name ${JSON.stringify(name)}`);
            }
            assertComponentName(value.component);
            if (value.output.length === 0)
                throw new Error("Output name must not be empty");
        }
    }
}
function freezeMigrationInputs(inputs) {
    return Object.freeze(Object.fromEntries(Object.entries(inputs).map(([migration, values]) => [
        migration,
        Object.freeze({ ...values }),
    ])));
}
function assertComponentName(component) {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(component)) {
        throw new Error(`Invalid component name ${JSON.stringify(component)}`);
    }
}
//# sourceMappingURL=index.js.map