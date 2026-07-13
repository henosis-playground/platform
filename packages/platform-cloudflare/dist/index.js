/** Constructors for Cloudflare component output contracts. */
export const h = Object.freeze({
    object(shape) {
        return Object.freeze({ kind: "object", shape });
    },
    string() {
        return Object.freeze({ kind: "string" });
    },
    url(options) {
        return Object.freeze({
            kind: "url",
            ...(options?.role === undefined ? {} : { role: options.role }),
        });
    },
});
/** Stable environment kinds supported by the Cloudflare connector. */
export const stableEnvKinds = ["dev", "prod"];
/** Static outputs published by every Cloudflare Worker component. */
export const workerOutputs = h.object({
    url: h.url({ role: "ui" }),
    workerName: h.string(),
    deploymentId: h.string(),
    versionId: h.string(),
    claimUrl: h.url(),
});
/**
 * Declares another component's output contract and returns completed typed refs.
 *
 * This is the hand-declared bridge until registry-generated declarations can be
 * imported directly from producer packages.
 */
export function declareOutputs(component, outputs) {
    assertComponentName(component);
    const references = Object.fromEntries(Object.entries(outputs.shape).map(([output, schema]) => [
        output,
        reference(schema.kind, component, output),
    ]));
    return Object.freeze(references);
}
/** Marks a referenced string output for secret binding at the target boundary. */
export function secret(output) {
    return reference("secret", output.component, output.output);
}
/** Defines one immutable Worker spec for separate per-repository execution. */
export function defineWorker(spec) {
    if (spec.outputs !== workerOutputs) {
        throw new Error("Cloudflare Workers must publish workerOutputs");
    }
    return Object.freeze({
        outputs: spec.outputs,
        ...(spec.vars === undefined ? {} : { inputs: Object.freeze(spec.vars) }),
        environments: ["dev", "prod", "preview"],
    });
}
/** Parses the exact environment grammar accepted by the Cloudflare connector. */
export function parseEnvironment(name) {
    if (name === "dev" || name === "prod")
        return { kind: name };
    if (/^preview_[0-9a-hjkmnp-tv-z]{26}$/.test(name)) {
        return { kind: "preview", id: name };
    }
    throw new Error(`Unsupported Cloudflare environment ${JSON.stringify(name)}`);
}
/** Formats a Cloudflare environment canonically. */
export function envName(env) {
    return env.kind === "preview" ? env.id : env.kind;
}
function reference(kind, component, output) {
    assertComponentName(component);
    if (output.length === 0)
        throw new Error("Output name must not be empty");
    return Object.freeze({ kind, component, output });
}
function assertComponentName(component) {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(component)) {
        throw new Error(`Invalid component name ${JSON.stringify(component)}`);
    }
}
//# sourceMappingURL=index.js.map