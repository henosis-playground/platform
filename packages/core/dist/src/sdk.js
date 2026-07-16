// === VALUES ===
const schemaSymbol = Symbol("henosis.schema");
function makeSchema(wire) {
    const schema = {
        kind: wire.kind,
        [schemaSymbol]: wire,
        default(value) {
            return Object.freeze({ schema: schema, default: value });
        },
    };
    return Object.freeze(schema);
}
export const value = Object.freeze({
    string: () => makeSchema({ kind: "string" }),
    url: () => makeSchema({ kind: "url" }),
    number: () => makeSchema({ kind: "number" }),
    boolean: () => makeSchema({ kind: "boolean" }),
    json: () => makeSchema({ kind: "json" }),
    array: (element) => makeSchema({ kind: "array", element: schemaWire(element) }),
    object: (fields) => makeSchema({
        kind: "object",
        fields: Object.freeze(Object.fromEntries(Object.entries(fields)
            .sort(([left], [right]) => compareCodeUnits(left, right))
            .map(([name, field]) => [name, schemaWire(field)]))),
    }),
});
export function schemaWire(schema) {
    return schema[schemaSymbol];
}
export const output = Object.freeze({
    static(schema) {
        return Object.freeze({ availability: "static", schema, optional: false });
    },
    optionalStatic(schema) {
        return Object.freeze({ availability: "static", schema, optional: true });
    },
    observed(schema) {
        return Object.freeze({ availability: "observed", schema, optional: false });
    },
    optionalObserved(schema) {
        return Object.freeze({ availability: "observed", schema, optional: true });
    },
});
const componentSymbol = Symbol.for("henosis.component.v1");
const outputHandleSymbol = Symbol.for("henosis.output-handle.v1");
const inputValueSymbol = Symbol("henosis.input-value");
const bindingSymbol = Symbol("henosis.output-binding");
const artifactSourceSymbol = Symbol.for("henosis.artifact-source.v1");
export const config = Object.freeze({
    file(path, sha256) {
        assertRepositoryPath(path, "configuration file");
        if (sha256 !== undefined)
            assertArtifactDigest(sha256, `configuration file ${quoted(path)}`);
        return Object.freeze({ path, ...(sha256 === undefined ? {} : { sha256 }) });
    },
});
export function defineResource(spec) {
    assertKind(spec.kind);
    const outputs = freezeOutputs(spec.outputs);
    const configFiles = Object.freeze([...(spec.configFiles ?? [])]);
    return Object.freeze({
        kind: spec.kind,
        outputs,
        configFiles,
        create(name, body) {
            assertTargetName(name, "resource name");
            return Object.freeze({ kind: spec.kind, name, body, outputs, configFiles });
        },
    });
}
export function defineComponent(spec) {
    assertTargetName(spec.name, "component name");
    const declarations = Object.freeze({ ...(spec.config ?? {}) });
    const files = Object.freeze([...(spec.files ?? [])]);
    const outputs = freezeOutputs(spec.outputs);
    for (const [name, declaration] of Object.entries(declarations)) {
        assertApiName(name, "config name");
        const normalized = normalizeConfigDeclaration(declaration);
        if (normalized.default !== undefined) {
            const defaultValue = snapshotJson(normalized.default, `default for config input ${name}`);
            assertSchemaValue(normalized.schema, defaultValue, `default for config input ${name}`);
        }
    }
    const definition = Object.freeze({ protocolVersion: 1, name: spec.name, config: declarations, files, outputs, build: spec.build });
    const handles = Object.freeze(Object.fromEntries(Object.entries(outputs).map(([name, declaration]) => [
        name,
        makeOutputHandle(spec.name, name, declaration),
    ])));
    return Object.freeze({ name: spec.name, outputs: handles, [componentSymbol]: definition });
}
export function getComponentDefinition(component) {
    return component[componentSymbol];
}
export function createBundle(component, closureFiles = [], derivedInputs = {}, compiledDependencies = [], revision = "unknown") {
    const definition = getComponentDefinition(component);
    const verifiedFiles = verifyClosureFiles(definition.files, closureFiles);
    const inputs = verifyDerivedInputs(definition, derivedInputs);
    return Object.freeze({
        protocolVersion: 1,
        component: metadata(definition, inputs, verifiedFiles, compiledDependencies, revision),
        evaluate: (snapshot) => executeComponent(component, snapshot, verifiedFiles, inputs),
    });
}
export function executeComponent(component, snapshot, closureFiles = [], derivedInputs = {}) {
    if (snapshot.protocolVersion !== 1) {
        throw diagnostic("HENOSIS_PROTOCOL_VERSION", `Unsupported snapshot protocol ${String(snapshot.protocolVersion)}.`, "Use the same HOST-PROTOCOL.md version on both sides of the isolate boundary.");
    }
    const definition = getComponentDefinition(component);
    const inputs = verifyDerivedInputs(definition, derivedInputs);
    const reads = new Set();
    const runtime = materializeInputs(definition.config, inputs, snapshot.inputs, reads);
    const sink = new ResourceSink(closureFiles);
    const context = Object.freeze({
        config: runtime.config,
        emit: sink.emit.bind(sink),
    });
    const previousEvaluation = activeEvaluation;
    activeEvaluation = runtime;
    try {
        const result = guardDeterminism(() => definition.build(context));
        const encoded = encodeOutputs(definition.outputs, result, sink.addresses());
        return Object.freeze({
            protocolVersion: 1,
            status: "complete",
            resources: sink.seal(),
            outputs: encoded.staticOutputs,
            observedOutputs: encoded.observedOutputs,
            reads: sorted(reads),
        });
    }
    catch (error) {
        if (error instanceof Blocked) {
            return Object.freeze({ protocolVersion: 1, status: "blocked", resources: sink.seal(), blocked: error.toWire(), reads: sorted(reads) });
        }
        sink.abort();
        throw error;
    }
    finally {
        activeEvaluation = previousEvaluation;
    }
}
// === DIAGNOSTICS ===
export class AuthoringError extends Error {
    code;
    summary;
    help;
    constructor(code, summary, help) {
        super(`error[${code}]: ${summary}\n  |\n  = help: ${help}`);
        this.code = code;
        this.summary = summary;
        this.help = help;
        this.name = "AuthoringError";
    }
}
export class Blocked extends Error {
    input;
    source;
    operation;
    code = "HENOSIS_BLOCKED";
    constructor(input, source, operation) {
        super(`blocked[HENOSIS_BLOCKED]: input ${quoted(input)} from ${source} is not available\n  |\n  = note: ${operation} requires its concrete value\n  = help: Henosis recorded this read and will re-run the component when the producer publishes it`);
        this.input = input;
        this.source = source;
        this.operation = operation;
        this.name = "Blocked";
    }
    toWire() {
        return Object.freeze({ code: this.code, input: this.input, source: this.source, operation: this.operation, message: this.message });
    }
}
function throwBlocked(input, source, operation) {
    const blocked = new Blocked(input, source, operation);
    const marker = globalThis.__henosis_mark_blocked;
    marker?.(Object.freeze({ input, source, operation, message: blocked.message }));
    throw blocked;
}
// === CANONICALIZATION ===
export function compareCodeUnits(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
export function canonicalStringify(input) { return JSON.stringify(canonicalize(input)); }
export function canonicalize(input) {
    if (Array.isArray(input))
        return Object.freeze(input.map(canonicalize));
    if (input !== null && typeof input === "object") {
        return Object.freeze(Object.fromEntries(Object.entries(input).sort(([a], [b]) => compareCodeUnits(a, b)).map(([key, child]) => [key, canonicalize(child)])));
    }
    return input;
}
let activeEvaluation;
class ResourceSink {
    state = "open";
    resources = [];
    seen = new Set();
    closureFiles;
    constructor(closureFiles) {
        this.closureFiles = new Map(closureFiles.map((file) => [file.path, file]));
    }
    emit(intent) {
        if (this.state !== "open")
            throw diagnostic("HENOSIS_CLOSED_EMITTER", `The resource emitter is already ${this.state}.`, "Emit synchronously while build is running.");
        const address = `${intent.kind}/${intent.name}`;
        if (this.seen.has(address))
            throw diagnostic("HENOSIS_DUPLICATE_RESOURCE", `Resource ${quoted(address)} was emitted more than once.`, "Give each resource of a kind a stable unique logical name.");
        const snapshot = snapshotJson(intent.body, `resource ${address}`);
        const body = resolveConfigFileReferences(snapshot, intent.configFiles, this.closureFiles, address);
        this.resources.push(Object.freeze({ address, kind: intent.kind, name: intent.name, body, canonical: canonicalStringify(body) }));
        this.seen.add(address);
        const outputs = Object.freeze(Object.fromEntries(Object.keys(intent.outputs).map((name) => [
            name,
            Object.freeze({ resource: address, output: name, [bindingSymbol]: undefined }),
        ])));
        return Object.freeze({ address, outputs });
    }
    addresses() { return this.seen; }
    seal() {
        if (this.state !== "open")
            throw diagnostic("HENOSIS_CLOSED_EMITTER", `The resource emitter is already ${this.state}.`, "The host seals an evaluation exactly once.");
        this.state = "sealed";
        return Object.freeze([...this.resources]);
    }
    abort() { this.state = "aborted"; this.resources.length = 0; this.seen.clear(); }
}
function makeOutputHandle(component, name, declaration) {
    const handle = {
        component,
        output: name,
        optional: declaration.optional,
        schema: declaration.schema,
        [outputHandleSymbol]: true,
    };
    Object.defineProperty(handle, "value", {
        enumerable: true,
        get: () => readOutput(component, name, "reading `.value`"),
    });
    if (declaration.optional) {
        Object.defineProperty(handle, "present", {
            enumerable: true,
            get: () => outputPresent(component, name),
        });
    }
    return Object.freeze(handle);
}
function readOutput(component, outputName, operation) {
    const runtime = activeEvaluation?.outputs.get(sourceKey(component, outputName));
    if (runtime === undefined) {
        throw diagnostic("HENOSIS_UNDECLARED_IMPORT", `Build inspected ${component}.outputs.${outputName}, but the bundle did not declare that imported output.`, "Rebuild with the Henosis bundler so imported output references are derived into component.inputs metadata.");
    }
    return readRuntimeInput(runtime, operation);
}
function outputPresent(component, outputName) {
    const runtime = activeEvaluation?.outputs.get(sourceKey(component, outputName));
    if (runtime === undefined) {
        throw diagnostic("HENOSIS_UNDECLARED_IMPORT", `Build inspected ${component}.outputs.${outputName}.present, but the bundle did not declare that imported output.`, "Rebuild with the Henosis bundler so imported output references are derived into component.inputs metadata.");
    }
    return runtime.cell.state !== "absent";
}
function readRuntimeInput(runtime, operation) {
    runtime.reads.add(runtime.name);
    if (runtime.cell.state === "blocked")
        throwBlocked(runtime.name, runtime.source, operation);
    if (runtime.cell.state === "absent")
        throw diagnostic("HENOSIS_ABSENT_INPUT_READ", `Optional input ${quoted(runtime.name)} is absent, but its .value was read.`, "Branch on the imported output's .present fact before reading .value.");
    return runtime.cell.value;
}
function materializeInputs(configDeclarations, derivedInputs, snapshot, reads) {
    const configValues = {};
    const outputs = new Map();
    const artifacts = new Map();
    for (const [name, declaration] of Object.entries(configDeclarations)) {
        const normalized = normalizeConfigDeclaration(declaration);
        const cell = snapshot[name];
        if (cell === undefined)
            throw diagnostic("HENOSIS_SNAPSHOT_MISSING_INPUT", `The host omitted declared input ${quoted(name)}.`, "Provide exactly one available cell for every graph config input.");
        if (cell.state !== "available")
            throw diagnostic("HENOSIS_REQUIRED_INPUT_ABSENT", `Graph config input ${quoted(name)} is ${cell.state}.`, "Config inputs must always be concrete after graph bindings and defaults are applied.");
        const runtime = Object.freeze({ name, source: `graph config ${name}`, cell, reads });
        const handle = {
            get value() { return readRuntimeInput(runtime, "reading `.value`"); },
            [inputValueSymbol]: runtime,
        };
        configValues[name] = Object.freeze(handle);
        assertSchemaValue(normalized.schema, cell.value, `graph config input ${name}`);
    }
    for (const [name, source] of Object.entries(derivedInputs)) {
        const cell = snapshot[name];
        if (cell === undefined)
            throw diagnostic("HENOSIS_SNAPSHOT_MISSING_INPUT", `The host omitted declared input ${quoted(name)}.`, "Build snapshots from this bundle revision's metadata.");
        if (isOutputHandle(source)) {
            if (cell.state === "absent" && !source.optional)
                throw diagnostic("HENOSIS_REQUIRED_INPUT_ABSENT", `Required input ${quoted(name)} (${source.component}.${source.output}) is absent.`, "Only optional producer outputs may be absent.");
            outputs.set(sourceKey(source.component, source.output), Object.freeze({ name, source: `${source.component}.${source.output}`, cell, reads }));
        }
        else {
            if (cell.state !== "available")
                throw diagnostic("HENOSIS_REQUIRED_INPUT_ABSENT", `Artifact input ${quoted(name)} is ${cell.state}.`, "The frontend must build and bind workload artifacts before evaluation.");
            assertSchemaValue(makeSchema({ kind: "artifact" }), cell.value, `artifact input ${name}`);
            artifacts.set(artifactKey(source.kind, source.path), Object.freeze({ name, source: `artifact ${source.path}`, cell, reads }));
        }
    }
    for (const extra of Object.keys(snapshot)) {
        if (!(extra in configDeclarations) && !(extra in derivedInputs))
            throw diagnostic("HENOSIS_SNAPSHOT_EXTRA_INPUT", `The host supplied undeclared input ${quoted(extra)}.`, "Build snapshots from this bundle revision's metadata.");
    }
    return Object.freeze({ config: Object.freeze(configValues), outputs, artifacts });
}
function encodeOutputs(declarations, result, emitted) {
    if (!isRecord(result))
        throw diagnostic("HENOSIS_OUTPUT_OBJECT", "A component build must return an output object.", "Return static values and observed bindings keyed by declared output name.");
    const staticOutputs = {};
    const observedOutputs = {};
    for (const [name, declaration] of Object.entries(declarations)) {
        const candidate = result[name];
        if (candidate === undefined && declaration.optional)
            continue;
        if (candidate === undefined)
            throw diagnostic("HENOSIS_OUTPUT_MISSING", `Build did not return required ${declaration.availability} output ${quoted(name)}.`, "Return every required output or use an optional declaration.");
        if (declaration.availability === "observed") {
            if (!isBinding(candidate))
                throw diagnostic("HENOSIS_OBSERVED_OUTPUT_BINDING", `Observed output ${quoted(name)} is not bound to an emitted resource output.`, "Use context.emit(resource).outputs.<name>; authors cannot invent observations.");
            if (!emitted.has(candidate.resource))
                throw diagnostic("HENOSIS_UNEMITTED_OUTPUT_BINDING", `Observed output ${quoted(name)} refers to un-emitted resource ${quoted(candidate.resource)}.`, "Bind outputs only from this build's emitted resources.");
            observedOutputs[name] = Object.freeze({ resource: candidate.resource, output: candidate.output });
        }
        else {
            const json = snapshotJson(candidate, `static output ${name}`);
            assertSchemaValue(declaration.schema, json, `static output ${name}`);
            staticOutputs[name] = json;
        }
    }
    for (const extra of Object.keys(result)) {
        if (!(extra in declarations))
            throw diagnostic("HENOSIS_OUTPUT_EXTRA", `Build returned undeclared output ${quoted(extra)}.`, "Declare the output or remove it.");
    }
    return Object.freeze({ staticOutputs: Object.freeze(staticOutputs), observedOutputs: Object.freeze(observedOutputs) });
}
function snapshotJson(candidate, location) {
    const ancestors = new Set();
    const visit = (current, path) => {
        if (isRecord(current) && outputHandleSymbol in current) {
            const handle = current;
            readOutput(handle.component, handle.output, `serializing ${path}`);
            throw diagnostic("HENOSIS_INPUT_HANDLE_SERIALIZED", `Imported output handle ${handle.component}.outputs.${handle.output} was placed into ${path}.`, `Use ${handle.component}.outputs.${handle.output}.value. Resources are total and cannot contain handles.`);
        }
        if (isRecord(current) && inputValueSymbol in current) {
            const runtime = current[inputValueSymbol];
            readRuntimeInput(runtime, `serializing ${path}`);
            throw diagnostic("HENOSIS_INPUT_HANDLE_SERIALIZED", `Config handle ${quoted(runtime.name)} was placed into ${path}.`, `Use context.config.${runtime.name}.value. Resources are total and cannot contain handles.`);
        }
        if (isRecord(current) && artifactSourceSymbol in current) {
            const source = current[artifactSourceSymbol];
            const runtime = activeEvaluation?.artifacts.get(artifactKey(source.kind, source.path));
            if (runtime === undefined)
                throw diagnostic("HENOSIS_UNDECLARED_ARTIFACT", `Resource references workload source ${quoted(source.path)}, but the bundle did not declare its artifact input.`, "Rebuild with the Henosis bundler so source.entry and source.assets are built and bound automatically.");
            return Object.freeze({ kind: source.kind, digest: readRuntimeInput(runtime, `serializing ${path}`) });
        }
        if (current === null || typeof current === "string" || typeof current === "boolean")
            return current;
        if (typeof current === "number") {
            if (!Number.isFinite(current))
                throw diagnostic("HENOSIS_NONFINITE_NUMBER", `${path} contains ${String(current)}.`, "Use a finite JSON number.");
            return current;
        }
        if (typeof current !== "object")
            throw diagnostic("HENOSIS_NON_JSON_VALUE", `${path} contains ${typeof current}.`, "Use only JSON values in resources and static outputs.");
        if (ancestors.has(current))
            throw diagnostic("HENOSIS_CYCLIC_VALUE", `${path} contains a cycle.`, "Return an acyclic JSON value.");
        ancestors.add(current);
        try {
            if (Array.isArray(current))
                return Object.freeze(current.map((child, index) => visit(child, `${path}[${index}]`)));
            const prototype = Object.getPrototypeOf(current);
            if (prototype !== Object.prototype && prototype !== null)
                throw diagnostic("HENOSIS_NON_PLAIN_OBJECT", `${path} contains a class instance.`, "Convert Dates, Maps, Sets, and classes to explicit plain JSON.");
            return Object.freeze(Object.fromEntries(Object.entries(current).sort(([a], [b]) => compareCodeUnits(a, b)).map(([key, child]) => [key, visit(child, `${path}.${key}`)])));
        }
        finally {
            ancestors.delete(current);
        }
    };
    return visit(candidate, location);
}
function guardDeterminism(run) {
    const now = Date.now;
    const random = Math.random;
    const forbidden = (name) => { throw diagnostic("HENOSIS_NONDETERMINISTIC_API", `${name} is unavailable while evaluating a component.`, "Derive desire only from declared config, imported outputs, and source constants."); };
    Date.now = () => forbidden("Date.now()");
    Math.random = () => forbidden("Math.random()");
    try {
        return run();
    }
    finally {
        Date.now = now;
        Math.random = random;
    }
}
function verifyDerivedInputs(definition, derivedInputs) {
    const seenOutputs = new Set();
    const seenArtifacts = new Set();
    const verified = {};
    for (const [name, source] of Object.entries(derivedInputs).sort(([left], [right]) => compareCodeUnits(left, right))) {
        assertApiName(name, "derived input name");
        if (name in definition.config)
            throw diagnostic("HENOSIS_INPUT_NAME_COLLISION", `Derived input ${quoted(name)} collides with graph config of the same name.`, "Rename the imported component alias or config field.");
        if (isOutputHandle(source)) {
            const key = sourceKey(source.component, source.output);
            if (seenOutputs.has(key))
                continue;
            seenOutputs.add(key);
        }
        else {
            assertRepositoryPath(source.path, "workload artifact source");
            const key = artifactKey(source.kind, source.path);
            if (seenArtifacts.has(key))
                continue;
            seenArtifacts.add(key);
        }
        verified[name] = source;
    }
    return Object.freeze(verified);
}
function verifyClosureFiles(declarations, closureFiles) {
    const sortedFiles = [...closureFiles].sort((left, right) => compareCodeUnits(left.path, right.path));
    const byPath = new Map(sortedFiles.map((file) => [file.path, file]));
    for (const declaration of declarations) {
        const file = byPath.get(declaration.path);
        if (file === undefined) {
            throw diagnostic("HENOSIS_FILE_CLOSURE", `Bundler omitted declared configuration file ${quoted(declaration.path)} from the closure.`, "Rebuild the bundle from the repository root and include every component files declaration.");
        }
        if (declaration.sha256 !== undefined && file.sha256 !== declaration.sha256) {
            throw diagnostic("HENOSIS_FILE_DIGEST", `Configuration file ${quoted(declaration.path)} expected ${declaration.sha256}, but the closure contains ${file.sha256}.`, "Update the expected digest or restore the intended file bytes.");
        }
    }
    if (byPath.size !== declarations.length) {
        throw diagnostic("HENOSIS_FILE_CLOSURE", "The bundler supplied configuration files not declared by the component.", "Rebuild the bundle from the current component source.");
    }
    return Object.freeze(sortedFiles.map((file) => Object.freeze({ ...file })));
}
function resolveConfigFileReferences(body, fields, closureFiles, address) {
    if (fields.length === 0)
        return body;
    const resolved = JSON.parse(JSON.stringify(body));
    for (const field of fields) {
        for (const reference of objectsAtPath(resolved, field.references)) {
            const candidate = reference[field.pathField];
            if (typeof candidate !== "string") {
                throw diagnostic("HENOSIS_RESOURCE_FILE_REF", `Resource ${quoted(address)} configuration-file field ${quoted(field.pathField)} is not a string.`, "Supply a declared repository-relative configuration-file path.");
            }
            assertRepositoryPath(candidate, `resource ${address} configuration file`);
            const closure = closureFiles.get(candidate);
            if (closure === undefined) {
                throw diagnostic("HENOSIS_RESOURCE_FILE_REF", `Resource ${quoted(address)} references configuration file ${quoted(candidate)}, but that file is not in its evaluation closure.`, "Add config.file(path) to the component files declaration.");
            }
            const expected = reference[field.digestField];
            if (expected !== undefined) {
                if (typeof expected !== "string") {
                    throw diagnostic("HENOSIS_FILE_DIGEST", `Resource ${quoted(address)} has a non-string digest for ${quoted(candidate)}.`, "Use sha256 followed by 64 lowercase hexadecimal digits, or omit the digest.");
                }
                assertArtifactDigest(expected, `resource ${quoted(address)} configuration file ${quoted(candidate)}`);
                if (expected !== closure.sha256) {
                    throw diagnostic("HENOSIS_FILE_DIGEST", `Resource ${quoted(address)} expected ${expected} for ${quoted(candidate)}, but the closure contains ${closure.sha256}.`, "Update the expected digest or restore the intended file bytes.");
                }
            }
            reference[field.digestField] = closure.sha256;
        }
    }
    return canonicalize(resolved);
}
function objectsAtPath(root, pointer) {
    const segments = pointer.split("/").slice(1).map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
    let values = [root];
    for (const segment of segments) {
        const next = [];
        for (const current of values) {
            if (segment === "*") {
                if (Array.isArray(current))
                    next.push(...current);
            }
            else if (current !== null && typeof current === "object" && !Array.isArray(current) && segment in current) {
                next.push(current[segment]);
            }
        }
        values = next;
    }
    return values.filter((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry));
}
function metadata(definition, derivedInputs, files, compiledDependencies, revision) {
    const inputs = {};
    for (const [name, declaration] of Object.entries(definition.config).sort(([left], [right]) => compareCodeUnits(left, right))) {
        const normalized = normalizeConfigDeclaration(declaration);
        inputs[name] = Object.freeze({
            source: "config",
            schema: schemaWire(normalized.schema),
            ...(normalized.default === undefined ? {} : { default: Object.freeze({ value: snapshotJson(normalized.default, `default for config input ${name}`) }) }),
        });
    }
    for (const [name, source] of Object.entries(derivedInputs)) {
        inputs[name] = isOutputHandle(source)
            ? Object.freeze({ component: source.component, output: source.output, optional: source.optional })
            : Object.freeze({ source: "config", schema: Object.freeze({ kind: "artifact" }) });
    }
    const dependencies = compiledDependencies
        .map((dependency) => {
        const producer = getComponentDefinition(dependency.component);
        const consumedOutputs = [...new Set(dependency.consumedOutputs)].sort(compareCodeUnits);
        for (const outputName of consumedOutputs) {
            if (!(outputName in producer.outputs)) {
                throw diagnostic("HENOSIS_BUNDLE_CONTRACT_OUTPUT", `Bundler recorded ${producer.name}.outputs.${outputName}, but the resolved producer does not declare it.`, "Rebuild after updating the consumer to use an output declared by the resolved producer.");
            }
        }
        return Object.freeze({
            component: producer.name,
            revision: dependency.revision,
            outputs: outputMetadata(producer.outputs),
            consumedOutputs: Object.freeze(consumedOutputs),
        });
    })
        .sort((left, right) => compareCodeUnits(left.component, right.component));
    for (let index = 1; index < dependencies.length; index += 1) {
        if (dependencies[index - 1]?.component === dependencies[index]?.component) {
            throw diagnostic("HENOSIS_BUNDLE_CONTRACT_DUPLICATE", `Bundler supplied contract facts for ${dependencies[index]?.component} more than once.`, "Aggregate consumed outputs per producer before calling createBundle().");
        }
    }
    return Object.freeze({
        name: definition.name,
        revision,
        inputs: Object.freeze(inputs),
        outputs: outputMetadata(definition.outputs),
        compiledDependencies: Object.freeze(dependencies),
        files,
    });
}
function outputMetadata(outputs) {
    return Object.freeze(Object.fromEntries(Object.entries(outputs)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([name, declaration]) => [name, Object.freeze({
            availability: declaration.availability,
            optional: declaration.optional,
            schema: schemaWire(declaration.schema),
        })])));
}
function normalizeConfigDeclaration(declaration) {
    return schemaSymbol in declaration
        ? { schema: declaration, default: undefined }
        : { schema: declaration.schema, default: declaration.default };
}
function freezeOutputs(outputs) {
    for (const [name, declaration] of Object.entries(outputs)) {
        assertApiName(name, "output name");
        if (declaration.availability !== "static" && declaration.availability !== "observed")
            throw diagnostic("HENOSIS_OUTPUT_AVAILABILITY", `Output ${quoted(name)} has invalid availability.`, "Use output.static(), output.observed(), or an optional form.");
    }
    return Object.freeze({ ...outputs });
}
function assertSchemaValue(schema, candidate, label) {
    const wire = schemaWire(schema);
    const fail = (expected) => { throw diagnostic("HENOSIS_OUTPUT_TYPE", `${label} expected ${expected}, received ${jsonKind(candidate)}.`, "Return a value matching the declared schema."); };
    switch (wire.kind) {
        case "string":
            if (typeof candidate !== "string")
                fail("string");
            return;
        case "url":
            if (typeof candidate !== "string" || !/^https?:\/\//u.test(candidate))
                fail("absolute HTTP(S) URL");
            return;
        case "number":
            if (typeof candidate !== "number")
                fail("number");
            return;
        case "boolean":
            if (typeof candidate !== "boolean")
                fail("boolean");
            return;
        case "json": return;
        case "artifact":
            if (typeof candidate !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(candidate))
                fail("artifact digest");
            return;
        case "array": {
            if (!Array.isArray(candidate))
                fail("array");
            for (const child of candidate)
                assertSchemaValue(makeSchema(wire.element), child, label);
            return;
        }
        case "object": {
            if (!isRecord(candidate) || Array.isArray(candidate))
                fail("object");
            const object = candidate;
            for (const [name, child] of Object.entries(wire.fields)) {
                if (!(name in object))
                    fail(`object with field ${name}`);
                assertSchemaValue(makeSchema(child), object[name], `${label}.${name}`);
            }
            return;
        }
    }
}
function isOutputHandle(candidate) { return isRecord(candidate) && candidate[outputHandleSymbol] === true; }
function isBinding(candidate) { return isRecord(candidate) && bindingSymbol in candidate; }
function sourceKey(component, outputName) { return `${component}\0${outputName}`; }
function artifactKey(kind, path) { return `${kind}\0${path}`; }
function assertKind(kind) { if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*@[1-9][0-9]*$/u.test(kind))
    throw diagnostic("HENOSIS_RESOURCE_KIND", `Invalid resource kind ${quoted(kind)}.`, "Use a versioned kind such as cloudflare/worker@1."); }
function assertRepositoryPath(path, label) {
    if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
        throw diagnostic("HENOSIS_FILE_PATH", `Invalid ${label} path ${quoted(path)}.`, "Use a normalized repository-relative path without empty, dot, parent, or backslash segments.");
    }
}
function assertArtifactDigest(digest, label) {
    if (!/^sha256:[0-9a-f]{64}$/u.test(digest))
        throw diagnostic("HENOSIS_ARTIFACT_DIGEST", `Invalid ${label} digest ${quoted(digest)}.`, "Use sha256 followed by 64 lowercase hexadecimal digits.");
}
function assertTargetName(name, label) { if (!/^[a-z][a-z0-9_-]{0,62}$/u.test(name))
    throw diagnostic("HENOSIS_LOGICAL_NAME", `Invalid ${label} ${quoted(name)}.`, "Resource logical names and component names flow into target identifiers. Use 1-63 lowercase letters, digits, underscores, or hyphens, beginning with a letter."); }
function assertApiName(name, label) { if (!/^[A-Za-z][A-Za-z0-9]{0,62}$/u.test(name))
    throw diagnostic("HENOSIS_API_NAME", `Invalid ${label} ${quoted(name)}.`, "Config, derived input, and output names are TypeScript API surface. Use 1-63 ASCII letters or digits, beginning with a letter; idiomatic camelCase is recommended."); }
function diagnostic(code, summary, help) { return new AuthoringError(code, summary, help); }
function quoted(input) { return JSON.stringify(input); }
function jsonKind(input) { return input === null ? "null" : Array.isArray(input) ? "array" : typeof input; }
function isRecord(input) { return typeof input === "object" && input !== null; }
function sorted(values) { return Object.freeze([...values].sort(compareCodeUnits)); }
//# sourceMappingURL=sdk.js.map