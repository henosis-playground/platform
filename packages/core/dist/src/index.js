/** The well-known property containing a component's renderer-facing definition. */
export const componentDefinitionSymbol = Symbol.for("henosis.component");
const componentRuntimeSymbol = Symbol.for("henosis.component.runtime.v2.d23");
const schemaSymbol = Symbol.for("henosis.schema");
const refSymbol = Symbol.for("henosis.ref");
const TYPEID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const TYPEID_VALUES = new Map([...TYPEID_ALPHABET].map((character, index) => [character, index]));
/** The fixed representative preview used by the widened merge gate. */
export const representativePreviewName = "preview_3jhc7x633z88188fzqhcbbrf84";
/** Constructors for Henosis output schemas. */
export const h = Object.freeze({
    object(shape) {
        return Object.freeze({
            kind: "object",
            shape,
            [schemaSymbol]: { kind: "object", shape },
        });
    },
    string() {
        return leafSchema("string");
    },
    url() {
        return leafSchema("url");
    },
    number() {
        return leafSchema("number");
    },
});
/** Error wrapper carrying one renderer-safe structured pipeline failure. */
export class PipelineError extends Error {
    failure;
    /** Creates a pipeline error from its stable serialized failure. */
    constructor(failure) {
        super(failure.message);
        this.failure = failure;
        this.name = "PipelineError";
    }
}
/**
 * Binds a frozen platform descriptor and returns its sole author-facing helper.
 */
export function definePlatform(spec) {
    const stableEnvKinds = validateAndCopyStableKinds(spec.stableEnvKinds);
    const identity = Object.freeze({ ...spec.identity });
    assertPlatformIdentity(identity);
    const validators = Object.freeze([...(spec.validators ?? [])]);
    assertValidatorIds(validators);
    const descriptor = Object.freeze({
        identity,
        stableEnvKinds,
        createContext: (input) => spec.createContext(input),
        ...(spec.finishRecords === undefined
            ? {}
            : {
                finishRecords: (ctx, records) => spec.finishRecords?.(ctx, records),
            }),
        ...(spec.dispose === undefined
            ? {}
            : {
                dispose: (ctx, outcome) => spec.dispose?.(ctx, outcome),
            }),
        ...(spec.project === undefined
            ? {}
            : {
                project: (input) => spec.project?.(input) ?? [],
            }),
        validators: validators,
    });
    const defineComponent = ((value) => defineForPlatform(descriptor, value));
    return Object.freeze({
        stableEnvKinds,
        defineComponent,
        parseEnvironment: (name) => parseEnvironmentName(stableEnvKinds, name),
        formatEnvironment: (env) => {
            assertSupportedEnvironment(stableEnvKinds, env);
            return formatEnvironment(env);
        },
    });
}
/** Gets the immutable definition stored behind a component's well-known symbol. */
export function getComponentDefinition(component) {
    return component[componentDefinitionSymbol];
}
/** Tests whether a value is a Henosis component default export. */
export function isComponentModule(value) {
    if (!isRecord(value) || !(componentDefinitionSymbol in value)) {
        return false;
    }
    const definition = value[componentDefinitionSymbol];
    return isComponentDefinition(definition);
}
/** Tests whether a value is a symbolic Henosis output ref. */
export function isRef(value) {
    return isRecord(value) && refSymbol in value && isOutputRefData(value[refSymbol]);
}
/** Gets the immutable producer definition carried by a symbolic ref. */
export function refSourceDefinition(value) {
    return value[refSymbol].source;
}
/** Gets the output path carried by a symbolic ref. */
export function refOutputPath(value) {
    return value[refSymbol].path;
}
/**
 * Discovers and verifies a world's one platform descriptor from defaults only.
 */
export function inspectWorldPlatform(components) {
    const descriptor = discoverDescriptor(components);
    return Object.freeze({
        identity: descriptor.identity,
        stableEnvKinds: descriptor.stableEnvKinds,
    });
}
/**
 * Evaluates, resolves, validates, and projects one world with no partial result.
 */
export function evaluateWorld(plan) {
    let descriptor;
    try {
        descriptor = discoverDescriptor(plan.components);
    }
    catch (error) {
        if (error instanceof PipelineError)
            throw error;
        throw pipelineFailure("platform-discovery", undefined, error);
    }
    try {
        assertSupportedEnvironment(descriptor.stableEnvKinds, plan.requestedEnv);
    }
    catch (error) {
        throw pipelineFailure("environment-validation", undefined, error);
    }
    const componentByName = new Map(plan.components.map((component) => [component.name, component]));
    assertUniqueComponents(plan.components);
    const changed = new Set(plan.changed);
    for (const name of changed) {
        if (!componentByName.has(name)) {
            throw pipelineFailure("environment-validation", name, new Error(`Changed component ${name} is not present in the world`));
        }
    }
    const reverseClosure = transitiveReverseClosure(changed, plan.dependencies);
    const order = topologicalComponentOrder(plan.components.map((component) => component.name), plan.dependencies);
    const evaluated = new Map();
    for (const name of order) {
        const component = componentByName.get(name);
        if (component === undefined) {
            throw pipelineFailure("environment-validation", name, new Error(`Missing component ${name}`));
        }
        const definition = getComponentDefinition(component.component);
        const borrowTarget = definition.borrowForPreview;
        const borrowed = plan.requestedEnv.kind === "preview" &&
            borrowTarget !== undefined &&
            !reverseClosure.has(name);
        if (borrowTarget !== undefined &&
            !descriptor.stableEnvKinds.includes(borrowTarget)) {
            throw pipelineFailure("environment-validation", name, new Error(`Unsupported borrowForPreview target ${borrowTarget}`));
        }
        const effectiveEnv = (borrowed
            ? { kind: borrowTarget }
            : plan.requestedEnv);
        const disposition = borrowed
            ? {
                kind: "borrowed",
                from: borrowTarget,
                effectiveEnv: { kind: borrowTarget },
            }
            : { kind: "materialized" };
        evaluated.set(name, evaluateOne(name, component, effectiveEnv, disposition));
    }
    let resolved;
    try {
        resolved = resolvePendingWorld(Object.fromEntries([...evaluated].map(([name, component]) => [
            name,
            {
                definition: component.definition,
                outputs: component.outputs,
                records: component.records,
            },
        ])));
    }
    catch (error) {
        const message = errorMessage(error);
        const component = plan.components.find(({ name }) => message.startsWith(`${name} `))?.name;
        throw pipelineFailure("resolution", component, error);
    }
    const definitionNames = new Map(plan.components.map((component) => [
        getComponentDefinition(component.component),
        component.name,
    ]));
    const validatorComponents = {};
    for (const name of order) {
        const component = required(evaluated.get(name));
        const resolvedComponent = required(resolved.components[name]);
        const outputIssues = validateSchema(component.definition.outputs, resolvedComponent.outputs);
        if (outputIssues.length > 0) {
            const issue = outputIssues[0];
            const pendingValue = deferredValueAtPath(component.outputs, issue?.path ?? []);
            const refSource = isRef(pendingValue)
                ? definitionNames.get(refSourceDefinition(pendingValue))
                : undefined;
            const message = formatOutputIssue(name, issue);
            throw pipelineFailure("resolved-output-validation", name, new Error(refSource === undefined || !isRef(pendingValue)
                ? message
                : `${name} consumes ${refSource}.${refOutputPath(pendingValue).join(".")}: ${message}`));
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
    const validatorWorld = Object.freeze({
        requestedEnv: plan.requestedEnv,
        components: Object.freeze(validatorComponents),
    });
    const issues = runWorldValidators(validatorWorld, descriptor.validators, plan.policyValidators ?? []);
    if (issues.length > 0) {
        throw new PipelineError({
            stage: "world-validation",
            message: `${issues.length} world validation issue(s)`,
            issues,
        });
    }
    const rendered = {};
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
        let projected = [];
        if (descriptor.project !== undefined) {
            try {
                projected = descriptor.project({
                    componentName: name,
                    env: component.effectiveEnv,
                    records: evidence.records,
                });
            }
            catch (error) {
                throw pipelineFailure("projection", name, error);
            }
        }
        let artifacts;
        try {
            artifacts = validateAndSortArtifacts(projected);
        }
        catch (error) {
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
/**
 * Runs every discovered stable kind plus the fixed representative preview.
 * The preview uses the supplied changed set, so unchanged eligible components
 * can borrow while changed members and reverse-dependants always materialize.
 */
export function evaluateGateWorlds(opts) {
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
    const environments = stableKinds.map((kind) => ({ kind: kind }));
    if (opts.widened !== false) {
        environments.push({
            kind: "preview",
            id: representativePreviewName,
        });
    }
    return Object.freeze(environments.map((environment) => {
        try {
            return {
                environment,
                ok: true,
                result: evaluateWorld({
                    requestedEnv: environment,
                    components: opts.components,
                    dependencies: opts.dependencies,
                    changed: environment.kind === "preview"
                        ? opts.changed
                        : opts.components.map((component) => component.name),
                    ...(opts.policyValidators === undefined
                        ? {}
                        : { policyValidators: opts.policyValidators }),
                }),
            };
        }
        catch (error) {
            return {
                environment,
                ok: false,
                failure: error instanceof PipelineError
                    ? error.failure
                    : {
                        stage: "build",
                        message: errorMessage(error),
                    },
            };
        }
    }));
}
/**
 * Resolves all outputs and record trees in one definition-identity world pass.
 * This function is the sole public constructor of branded resolved records.
 */
export function resolvePendingWorld(pending) {
    const definitionNames = new Map();
    for (const [name, component] of Object.entries(pending)) {
        if (definitionNames.has(component.definition)) {
            throw new Error(`Component definition imported more than once (${name})`);
        }
        definitionNames.set(component.definition, name);
    }
    const outputCache = new Map();
    const resolving = new Set();
    const dependencySets = new Map();
    const dependenciesFor = (name) => {
        let dependencies = dependencySets.get(name);
        if (dependencies === undefined) {
            dependencies = new Set();
            dependencySets.set(name, dependencies);
        }
        return dependencies;
    };
    const resolveOutput = (name) => {
        const cached = outputCache.get(name);
        if (cached !== undefined)
            return cached;
        if (resolving.has(name)) {
            throw new Error(`Component reference cycle at ${name}`);
        }
        const component = pending[name];
        if (component === undefined) {
            throw new Error(`Missing referenced component ${name}`);
        }
        resolving.add(name);
        try {
            const value = resolveDeferredValue(component.outputs, name, definitionNames, dependenciesFor(name), resolveOutput);
            outputCache.set(name, value);
            return value;
        }
        finally {
            resolving.delete(name);
        }
    };
    const components = {};
    for (const name of Object.keys(pending).sort(compareCodeUnits)) {
        const component = required(pending[name]);
        const dependencies = dependenciesFor(name);
        const outputs = resolveOutput(name);
        const records = component.records.map((record) => brandResolvedRecord({
            kind: record.kind,
            data: resolveDeferredValue(record.data, name, definitionNames, dependencies, resolveOutput),
        }));
        components[name] = Object.freeze({
            outputs,
            records: Object.freeze(records),
            dependencies: Object.freeze([...dependencies].sort(compareCodeUnits)),
        });
    }
    return Object.freeze({ components: Object.freeze(components) });
}
/** Runs intrinsic then policy validators and returns every ordered issue. */
export function runWorldValidators(world, platformValidators, policyValidators) {
    const groups = [
        ["platform", platformValidators],
        ["policy", policyValidators],
    ];
    const seenIds = new Set();
    const collected = [];
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
            let issues;
            try {
                issues = validator.validate(world);
            }
            catch (error) {
                throw new PipelineError({
                    stage: "validator",
                    message: `Validator ${validator.id} threw: ${errorMessage(error)}`,
                });
            }
            for (const issue of issues) {
                assertValidationIssue(issue, world);
                collected.push({
                    ...issue,
                    validator: validator.id,
                    source,
                    validatorOrder,
                });
            }
            validatorOrder += 1;
        }
    }
    collected.sort((left, right) => left.validatorOrder - right.validatorOrder ||
        compareCodeUnits(left.component, right.component) ||
        (left.record?.index ?? -1) - (right.record?.index ?? -1) ||
        compareCodeUnits(left.record?.path ?? "", right.record?.path ?? "") ||
        compareCodeUnits(left.code, right.code) ||
        compareCodeUnits(left.message, right.message));
    const result = [];
    const seen = new Set();
    for (const { validatorOrder: ignored, ...issue } of collected) {
        void ignored;
        const key = JSON.stringify(issue);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(Object.freeze(issue));
        }
    }
    return Object.freeze(result);
}
/** Validates a value against an introspectable Henosis output schema. */
export function validateSchema(schema, value, opts = {}) {
    return validateAgainstSchema(schema, value, [], opts.allowRefs === true);
}
/** Validates, duplicate-checks, and code-unit sorts projected artifacts. */
export function validateAndSortArtifacts(artifacts) {
    const paths = new Set();
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
    return Object.freeze(result.sort((left, right) => compareCodeUnits(left.path, right.path)));
}
/** Code-unit comparison, deterministic across locale and ICU versions. */
export function compareCodeUnits(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
/** Formats one canonical stable or preview environment identity. */
export function formatEnvironment(env) {
    if (env.kind === "preview" && "id" in env) {
        assertPreviewEnvironmentName(env.id);
        return env.id;
    }
    validateStableKind(env.kind);
    return env.kind;
}
/** Parses the strict stable/TypeID grammar with a marked legacy-preview shim. */
export function parseEnvironmentName(stableKinds, name) {
    validateAndCopyStableKinds(stableKinds);
    if (stableKinds.includes(name)) {
        return { kind: name };
    }
    if (!name.startsWith("preview_") && !name.startsWith("preview-")) {
        throw new Error(`Unknown environment ${JSON.stringify(name)}; expected ${stableKinds.join(", ")} or preview_<typeid>`);
    }
    assertPreviewEnvironmentName(name);
    return { kind: "preview", id: name };
}
/** Validates a programmatic environment against a discovered platform. */
export function assertSupportedEnvironment(stableKinds, env) {
    if (env.kind === "preview" && "id" in env) {
        assertPreviewEnvironmentName(env.id);
        return;
    }
    if (!stableKinds.includes(env.kind)) {
        throw new Error(`Unsupported stable environment ${JSON.stringify(env.kind)}; platform supports ${stableKinds.join(", ")}`);
    }
}
/** Encodes a UUID as one canonical lowercase TypeID. */
export function typeIdFromUuid(prefix, uuid) {
    if (!/^[a-z](?:[a-z0-9_]{0,61}[a-z0-9])?$/.test(prefix)) {
        throw new Error(`Invalid TypeID prefix ${JSON.stringify(prefix)}`);
    }
    const match = /^([0-9a-fA-F]{8})-([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-([0-9a-fA-F]{12})$/.exec(uuid);
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
/** Decodes a canonical TypeID and returns its lowercase UUID. */
export function uuidFromTypeId(typeId, expectedPrefix) {
    const separator = typeId.lastIndexOf("_");
    const prefix = separator === -1 ? "" : typeId.slice(0, separator);
    const suffix = separator === -1 ? "" : typeId.slice(separator + 1);
    if (!/^[a-z](?:[a-z0-9_]{0,61}[a-z0-9])?$/.test(prefix) ||
        suffix.length !== 26 ||
        !/^[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(suffix) ||
        (expectedPrefix !== undefined && prefix !== expectedPrefix)) {
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
export function isLegacyPreviewEnvironmentName(name) {
    return (name.length <= 63 &&
        /^preview-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name));
}
function defineForPlatform(descriptor, value) {
    if (!isRecord(value) ||
        !isObjectSchema(value.outputs) ||
        typeof value.build !== "function") {
        throw new Error("Invalid component definition");
    }
    assertValidOutputNames(value.outputs);
    const borrowForPreview = value.borrowForPreview;
    if (borrowForPreview !== undefined &&
        (typeof borrowForPreview !== "string" ||
            !descriptor.stableEnvKinds.includes(borrowForPreview))) {
        throw new Error(`borrowForPreview must be one of ${descriptor.stableEnvKinds.join(", ")}`);
    }
    const params = value.params;
    if (params !== undefined) {
        assertExactParamRows(params, descriptor.stableEnvKinds);
    }
    const runtime = Object.freeze({
        descriptor,
        ...(params === undefined
            ? {}
            : { params: params }),
        build: value.build,
    });
    const definition = Object.freeze({
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
    return Object.freeze(refs);
}
function evaluateOne(name, component, effectiveEnv, disposition) {
    const definition = getComponentDefinition(component.component);
    const runtime = definition[componentRuntimeSymbol];
    const sink = new TransactionalRecordSink();
    let context;
    try {
        context = runtime.descriptor.createContext({
            componentName: name,
            env: effectiveEnv,
            image: component.image,
            records: sink,
        });
    }
    catch (error) {
        sink.abort();
        throw pipelineFailure("create-context", name, error);
    }
    const abort = (stage, primary) => {
        sink.abort();
        let message = errorMessage(primary);
        try {
            runtime.descriptor.dispose?.(context, {
                status: "aborted",
                stage,
            });
        }
        catch (disposeError) {
            message = `${message}; dispose also failed: ${errorMessage(disposeError)}`;
        }
        throw new PipelineError({ stage, component: name, message });
    };
    let outputs;
    try {
        if (runtime.params === undefined) {
            outputs = runtime.build(context);
        }
        else {
            const row = runtime.params[effectiveEnv.kind];
            if (row === undefined) {
                return abort("build", new Error(`Missing params row ${effectiveEnv.kind}`));
            }
            outputs = runtime.build(context, row);
        }
    }
    catch (error) {
        return abort("build", error);
    }
    let outputIssues;
    try {
        outputIssues = validateSchema(definition.outputs, outputs, {
            allowRefs: true,
        });
    }
    catch (error) {
        return abort("pending-output-validation", error);
    }
    if (outputIssues.length > 0) {
        return abort("pending-output-validation", new Error(formatOutputIssue(name, outputIssues[0])));
    }
    try {
        runtime.descriptor.finishRecords?.(context, sink);
    }
    catch (error) {
        return abort("finish-records", error);
    }
    const records = sink.seal();
    try {
        runtime.descriptor.dispose?.(context, { status: "sealed" });
    }
    catch (error) {
        throw pipelineFailure("dispose", name, error);
    }
    return Object.freeze({
        definition,
        effectiveEnv,
        disposition,
        outputs: outputs,
        records,
    });
}
class TransactionalRecordSink {
    #records = [];
    #state = "open";
    write(record) {
        this.assertOpen();
        if (typeof record.kind !== "string" || record.kind.length === 0) {
            throw new Error("Record kind must be a non-empty string");
        }
        this.#records.push(Object.freeze({
            kind: record.kind,
            data: record.data,
        }));
    }
    assertOpen() {
        if (this.#state !== "open") {
            throw new Error(`Record transaction is ${this.#state}`);
        }
    }
    seal() {
        this.assertOpen();
        this.#state = "sealed";
        return Object.freeze([...this.#records]);
    }
    abort() {
        if (this.#state === "open") {
            this.#records.length = 0;
            this.#state = "aborted";
        }
    }
}
function discoverDescriptor(components) {
    const first = components[0];
    if (first === undefined) {
        throw new PipelineError({
            stage: "platform-discovery",
            message: "A Henosis world must contain at least one component",
        });
    }
    const descriptor = getComponentDefinition(first.component)[componentRuntimeSymbol].descriptor;
    for (const component of components.slice(1)) {
        const candidate = getComponentDefinition(component.component)[componentRuntimeSymbol].descriptor;
        if (candidate === descriptor)
            continue;
        const sameMetadata = identityKey(candidate.identity) === identityKey(descriptor.identity) &&
            candidate.stableEnvKinds.join("\0") ===
                descriptor.stableEnvKinds.join("\0");
        const problem = sameMetadata
            ? "duplicate platform installation"
            : "mixed platforms";
        throw new PipelineError({
            stage: "platform-discovery",
            component: component.name,
            message: `${problem}: ${formatIdentity(descriptor.identity)} at ` +
                `${first.origin.platformPath} (${first.name}) vs ` +
                `${formatIdentity(candidate.identity)} at ` +
                `${component.origin.platformPath} (${component.name})`,
        });
    }
    return descriptor;
}
function assertUniqueComponents(components) {
    const names = new Set();
    const definitions = new Set();
    for (const component of components) {
        if (names.has(component.name)) {
            throw pipelineFailure("platform-discovery", component.name, new Error(`Duplicate component name ${component.name}`));
        }
        names.add(component.name);
        const definition = getComponentDefinition(component.component);
        if (definitions.has(definition)) {
            throw pipelineFailure("platform-discovery", component.name, new Error(`Component definition imported more than once`));
        }
        definitions.add(definition);
    }
}
function resolveDeferredValue(value, consumer, definitionNames, dependencies, resolveOutput) {
    if (isRef(value)) {
        const data = value[refSymbol];
        const source = definitionNames.get(data.source);
        if (source === undefined) {
            throw new Error(`${consumer} contains a ref to ${data.path.join(".")} from a component outside this world`);
        }
        dependencies.add(source);
        let current = resolveOutput(source);
        for (const segment of data.path) {
            if (!isRecord(current) || !(segment in current)) {
                throw new Error(`${consumer} consumes missing ${source}.${data.path.join(".")}`);
            }
            current = current[segment];
        }
        return current;
    }
    if (value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((child) => resolveDeferredValue(child, consumer, definitionNames, dependencies, resolveOutput));
    }
    if (!isRecord(value)) {
        throw new Error(`${consumer} emitted non-JSON data`);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        resolveDeferredValue(child, consumer, definitionNames, dependencies, resolveOutput),
    ]));
}
function deferredValueAtPath(value, pathParts) {
    let current = value;
    for (const part of pathParts) {
        if (!isRecord(current) || !(part in current))
            return undefined;
        current = current[part];
    }
    return current;
}
function makeRefObject(schema, source, prefix) {
    return Object.fromEntries(Object.entries(schema.shape).map(([key, child]) => [
        key,
        isObjectSchema(child)
            ? makeRefObject(child, source, [...prefix, key])
            : makeRef(source, [...prefix, key]),
    ]));
}
function makeRef(source, path) {
    return Object.freeze({
        [refSymbol]: Object.freeze({ source, path: Object.freeze([...path]) }),
    });
}
function leafSchema(kind) {
    return Object.freeze({ kind, [schemaSymbol]: { kind } });
}
function validateAgainstSchema(schema, value, path, allowRefs) {
    if (allowRefs && isRef(value))
        return [];
    const data = getSchemaData(schema);
    if (data.kind === "object") {
        if (!isRecord(value)) {
            return [outputIssue(path, "object", actualType(value))];
        }
        const shape = data.shape ?? {};
        const issues = [];
        for (const [key, child] of Object.entries(shape)) {
            if (!(key in value)) {
                issues.push(outputIssue([...path, key], schemaKind(child), "missing"));
            }
            else {
                issues.push(...validateAgainstSchema(child, value[key], [...path, key], allowRefs));
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
function outputIssue(path, expected, actual) {
    return { path, expected, actual };
}
function formatOutputIssue(component, issue) {
    if (issue === undefined)
        return `${component} output validation failed`;
    const path = issue.path.length === 0 ? "" : `.${issue.path.join(".")}`;
    return `${component}${path} expected ${issue.expected}, got ${issue.actual}`;
}
function actualType(value) {
    if (isRef(value))
        return "ref";
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    if (typeof value === "string")
        return isHttpUrl(value) ? "url" : "string";
    return typeof value;
}
function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch {
        return false;
    }
}
function getSchemaData(schema) {
    if (!isRecord(schema) || !(schemaSymbol in schema)) {
        throw new Error("Invalid Henosis schema");
    }
    const data = schema[schemaSymbol];
    if (!isSchemaData(data))
        throw new Error("Invalid Henosis schema");
    return data;
}
function schemaKind(schema) {
    return getSchemaData(schema).kind;
}
function isObjectSchema(value) {
    return (isRecord(value) &&
        value.kind === "object" &&
        isRecord(value.shape) &&
        schemaSymbol in value);
}
function isSchemaData(value) {
    return (isRecord(value) &&
        (value.kind === "string" ||
            value.kind === "url" ||
            value.kind === "number" ||
            (value.kind === "object" && isRecord(value.shape))));
}
function isComponentDefinition(value) {
    return (isRecord(value) &&
        isObjectSchema(value.outputs) &&
        componentRuntimeSymbol in value &&
        isComponentRuntime(value[componentRuntimeSymbol]));
}
function isComponentRuntime(value) {
    return (isRecord(value) &&
        isRecord(value.descriptor) &&
        typeof value.build === "function");
}
function isOutputRefData(value) {
    return (isRecord(value) &&
        isComponentDefinition(value.source) &&
        Array.isArray(value.path) &&
        value.path.every((segment) => typeof segment === "string"));
}
function brandResolvedRecord(record) {
    return Object.freeze(record);
}
function assertValidationIssue(issue, world) {
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
        if (!Number.isInteger(issue.record.index) ||
            issue.record.index < 0 ||
            issue.record.index >= component.records.length) {
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
function isJsonPointer(value) {
    return value === "" || /^(?:\/(?:[^~/]|~[01])*)+$/.test(value);
}
function assertValidatorIds(validators) {
    const seen = new Set();
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
function assertExactParamRows(value, stableKinds) {
    if (!isRecord(value))
        throw new Error("params must be an object");
    const expected = [...stableKinds, "preview"].sort(compareCodeUnits);
    const actual = Object.keys(value).sort(compareCodeUnits);
    if (expected.join("\0") !== actual.join("\0")) {
        throw new Error(`params rows must be exactly ${expected.join(", ")}; received ${actual.join(", ")}`);
    }
    for (const key of expected) {
        if (!isRecord(value[key])) {
            throw new Error(`params.${key} must be an object`);
        }
    }
}
function assertValidOutputNames(schema, path = []) {
    for (const [key, child] of Object.entries(schema.shape)) {
        const childPath = [...path, key];
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
            throw new Error(`Invalid component output name ${JSON.stringify(childPath.join("."))}: output names must be dot-accessible identifiers`);
        }
        if (key === "__proto__" ||
            key === "prototype" ||
            key === "constructor") {
            throw new Error(`Invalid component output name ${JSON.stringify(childPath.join("."))}: reserved object property names are not allowed`);
        }
        if (isObjectSchema(child)) {
            assertValidOutputNames(child, childPath);
        }
    }
}
function validateAndCopyStableKinds(kinds) {
    if (kinds.length === 0) {
        throw new Error("A platform must define at least one stable environment kind");
    }
    const seen = new Set();
    for (const kind of kinds) {
        validateStableKind(kind);
        if (seen.has(kind)) {
            throw new Error(`Duplicate stable environment kind ${kind}`);
        }
        seen.add(kind);
    }
    return Object.freeze([...kinds]);
}
function validateStableKind(kind) {
    if (kind.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(kind) ||
        kind.startsWith("preview")) {
        throw new Error(`Invalid or reserved stable environment kind ${JSON.stringify(kind)}`);
    }
}
function assertPreviewEnvironmentName(name) {
    if (isLegacyPreviewEnvironmentName(name))
        return;
    const uuid = uuidFromTypeId(name, "preview");
    if (typeIdFromUuid("preview", uuid) !== name) {
        throw new Error(`Non-canonical preview TypeID ${JSON.stringify(name)}`);
    }
}
function assertPlatformIdentity(identity) {
    if (!/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(identity.packageName)) {
        throw new Error(`Invalid platform package name ${identity.packageName}`);
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(identity.packageVersion)) {
        throw new Error(`Invalid platform package version ${identity.packageVersion}`);
    }
    if (identity.apiVersion !== 2) {
        throw new Error(`Unsupported platform API version ${identity.apiVersion}`);
    }
}
function topologicalComponentOrder(names, graph) {
    const nameSet = new Set(names);
    const visiting = new Set();
    const visited = new Set();
    const order = [];
    const visit = (name) => {
        if (visited.has(name))
            return;
        if (visiting.has(name)) {
            throw pipelineFailure("environment-validation", name, new Error(`Component dependency cycle at ${name}`));
        }
        visiting.add(name);
        for (const dependency of [...(graph[name] ?? [])].sort(compareCodeUnits)) {
            if (nameSet.has(dependency))
                visit(dependency);
        }
        visiting.delete(name);
        visited.add(name);
        order.push(name);
    };
    for (const name of [...names].sort(compareCodeUnits))
        visit(name);
    return Object.freeze(order);
}
function transitiveReverseClosure(seeds, dependencies) {
    const result = new Set(seeds);
    const queue = [...seeds];
    while (queue.length > 0) {
        const dependency = queue.shift();
        if (dependency === undefined)
            continue;
        for (const [consumer, producerNames] of Object.entries(dependencies)) {
            if (producerNames.includes(dependency) && !result.has(consumer)) {
                result.add(consumer);
                queue.push(consumer);
            }
        }
    }
    return result;
}
function validateArtifactPath(value) {
    if (value.length === 0 ||
        value.startsWith("/") ||
        value.includes("\\") ||
        value.includes("\0") ||
        value.split("/").some((segment) => segment.length === 0 ||
            segment === "." ||
            segment === ".." ||
            !/^[a-z0-9][a-z0-9._-]*$/.test(segment))) {
        throw new Error(`Unsafe artifact path ${JSON.stringify(value)}`);
    }
}
function pipelineFailure(stage, component, error) {
    return new PipelineError({
        stage,
        ...(component === undefined ? {} : { component }),
        message: errorMessage(error),
    });
}
function identityKey(identity) {
    return `${identity.packageName}@${identity.packageVersion}/api-${identity.apiVersion}`;
}
function formatIdentity(identity) {
    return `${identity.packageName}@${identity.packageVersion} (API ${identity.apiVersion})`;
}
function required(value) {
    if (value === undefined)
        throw new Error("Required value was absent");
    return value;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=index.js.map