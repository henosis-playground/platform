// === VALUES ===
const schemaSymbol = Symbol("henosis.schema");
function makeSchema(wire) {
    return Object.freeze({ kind: wire.kind, [schemaSymbol]: wire });
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
export const native = Object.freeze({
    file(path, sha256) {
        assertRepositoryPath(path, "native file");
        if (sha256 !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(sha256)) {
            throw diagnostic("HENOSIS_FILE_DIGEST", `Native file ${quoted(path)} has invalid expected digest ${quoted(sha256)}.`, "Use sha256 followed by 64 lowercase hexadecimal digits, or omit the digest and let the bundler compute it.");
        }
        return Object.freeze({ path, kind: "file", ...(sha256 === undefined ? {} : { sha256 }) });
    },
    directory(path) {
        assertRepositoryPath(path, "native directory");
        return Object.freeze({ path, kind: "directory" });
    },
});
export const input = Object.freeze({
    required(source) {
        return Object.freeze({ kind: "output", source, optional: false });
    },
    optional(source) {
        return Object.freeze({ kind: "output", source, optional: true });
    },
    config(schema, options = {}) {
        return Object.freeze({ kind: "config", schema, optional: false, ...options });
    },
});
export function defineResource(spec) {
    assertKind(spec.kind);
    const outputs = freezeOutputs(spec.outputs);
    const nativeFiles = Object.freeze([...(spec.nativeFiles ?? [])]);
    return Object.freeze({
        kind: spec.kind,
        outputs,
        nativeFiles,
        create(name, body) {
            assertTargetName(name, "resource name");
            return Object.freeze({ kind: spec.kind, name, body, outputs, nativeFiles });
        },
    });
}
export function defineComponent(spec) {
    assertTargetName(spec.name, "component name");
    const inputs = Object.freeze({ ...(spec.inputs ?? {}) });
    const files = Object.freeze([...(spec.files ?? [])]);
    const outputs = freezeOutputs(spec.outputs);
    for (const [name, declaration] of Object.entries(inputs)) {
        assertApiName(name, "input name");
        if (declaration.kind === "output") {
            if (!isOutputHandle(declaration.source)) {
                throw diagnostic("HENOSIS_INPUT_SOURCE", `Input ${quoted(name)} does not reference a component output.`, "Import the producer and use input.required(producer.outputs.<name>) or input.optional(...).");
            }
            if (declaration.optional && !declaration.source.optional) {
                throw diagnostic("HENOSIS_OPTIONAL_INPUT", `Input ${quoted(name)} is optional, but ${sourceLabel(name, declaration)} is required.`, "Make the producer output optional or consume it with input.required(...).");
            }
        }
        else if ("default" in declaration) {
            const defaultValue = snapshotJson(declaration.default, `default for config input ${name}`);
            assertSchemaValue(declaration.schema, defaultValue, `default for config input ${name}`);
        }
    }
    const definition = Object.freeze({ protocolVersion: 1, name: spec.name, inputs, files, outputs, build: spec.build });
    const handles = Object.freeze(Object.fromEntries(Object.entries(outputs).map(([name, declaration]) => [
        name,
        Object.freeze({ component: spec.name, output: name, optional: declaration.optional, [outputHandleSymbol]: true }),
    ])));
    return Object.freeze({ name: spec.name, outputs: handles, [componentSymbol]: definition });
}
export function getComponentDefinition(component) {
    return component[componentSymbol];
}
export function createBundle(component, closureFiles = []) {
    const definition = getComponentDefinition(component);
    const verifiedFiles = verifyClosureFiles(definition.files, closureFiles);
    return Object.freeze({
        protocolVersion: 1,
        component: metadata(definition, verifiedFiles),
        evaluate: (snapshot) => executeComponent(component, snapshot, verifiedFiles),
    });
}
export function executeComponent(component, snapshot, closureFiles = []) {
    if (snapshot.protocolVersion !== 1) {
        throw diagnostic("HENOSIS_PROTOCOL_VERSION", `Unsupported snapshot protocol ${String(snapshot.protocolVersion)}.`, "Use the same HOST-PROTOCOL.md version on both sides of the isolate boundary.");
    }
    const definition = getComponentDefinition(component);
    const reads = new Set();
    const sink = new ResourceSink(closureFiles);
    const inputs = materializeInputs(definition.inputs, snapshot.inputs, reads);
    try {
        const result = guardDeterminism(() => definition.build(sink, inputs));
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
// === EXECUTION INTERNALS ===
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
        const body = snapshotJson(intent.body, `resource ${address}`);
        const files = extractNativeFileReferences(body, intent.nativeFiles, this.closureFiles, address);
        this.resources.push(Object.freeze({ address, kind: intent.kind, name: intent.name, body, canonical: canonicalStringify(body), files }));
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
function materializeInputs(declarations, snapshot, reads) {
    const result = {};
    for (const [name, declaration] of Object.entries(declarations)) {
        const cell = snapshot[name];
        if (cell === undefined)
            throw diagnostic("HENOSIS_SNAPSHOT_MISSING_INPUT", `The host omitted declared input ${quoted(name)}.`, "Provide exactly one available, blocked, or absent cell for every declared input.");
        if (cell.state === "absent" && !declaration.optional)
            throw diagnostic("HENOSIS_REQUIRED_INPUT_ABSENT", `Required input ${quoted(name)} (${sourceLabel(name, declaration)}) is absent.`, "Only optional producer outputs may be absent.");
        const handle = {
            ...(declaration.optional ? { present: cell.state !== "absent" } : {}),
            get value() {
                reads.add(name);
                if (cell.state === "blocked")
                    throwBlocked(name, sourceLabel(name, declaration), "reading `.value`");
                if (cell.state === "absent")
                    throw diagnostic("HENOSIS_ABSENT_INPUT_READ", `Optional input ${quoted(name)} is absent, but its .value was read.`, `Branch on inputs.${name}.present before reading inputs.${name}.value.`);
                return cell.value;
            },
            [inputValueSymbol]: Object.freeze({
                name,
                source: sourceLabel(name, declaration),
                state: cell.state,
                markRead: () => { reads.add(name); },
            }),
        };
        result[name] = Object.freeze(handle);
    }
    for (const extra of Object.keys(snapshot)) {
        if (!(extra in declarations))
            throw diagnostic("HENOSIS_SNAPSHOT_EXTRA_INPUT", `The host supplied undeclared input ${quoted(extra)}.`, "Build snapshots from this bundle revision's metadata.");
    }
    return Object.freeze(result);
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
        if (isRecord(current) && inputValueSymbol in current) {
            const details = current[inputValueSymbol];
            details.markRead();
            if (details.state === "blocked")
                throwBlocked(details.name, details.source, `serializing ${path}`);
            throw diagnostic("HENOSIS_INPUT_HANDLE_SERIALIZED", `Input handle ${quoted(details.name)} was placed into ${path}.`, `Use inputs.${details.name}.value. Resources are total and cannot contain handles.`);
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
    const forbidden = (name) => { throw diagnostic("HENOSIS_NONDETERMINISTIC_API", `${name} is unavailable while evaluating a component.`, "Derive desire only from declared inputs and source constants."); };
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
function verifyClosureFiles(declarations, closureFiles) {
    const sortedFiles = [...closureFiles].sort((left, right) => compareCodeUnits(left.path, right.path));
    if (sortedFiles.length === 0)
        return Object.freeze(sortedFiles);
    const byPath = new Map(sortedFiles.map((file) => [file.path, file]));
    for (const declaration of declarations) {
        const matches = declaration.kind === "file"
            ? [byPath.get(declaration.path)].filter((file) => file !== undefined)
            : sortedFiles.filter((file) => file.path.startsWith(`${declaration.path.replace(/\/$/u, "")}/`));
        if (matches.length === 0) {
            throw diagnostic("HENOSIS_FILE_CLOSURE", `Bundler omitted declared ${declaration.kind} ${quoted(declaration.path)} from the closure.`, "Rebuild the bundle from the repository root and include every component files declaration.");
        }
        if (declaration.sha256 !== undefined && matches[0]?.sha256 !== declaration.sha256) {
            throw diagnostic("HENOSIS_FILE_DIGEST", `Native file ${quoted(declaration.path)} expected ${declaration.sha256}, but the closure contains ${String(matches[0]?.sha256)}.`, "Update the expected digest or restore the intended file bytes.");
        }
    }
    return Object.freeze(sortedFiles.map((file) => Object.freeze({ ...file })));
}
function extractNativeFileReferences(body, fields, closureFiles, address) {
    const references = [];
    for (const field of fields) {
        const paths = valuesAtPath(body, field.path);
        const expected = field.expectedSha256Path === undefined ? [] : valuesAtPath(body, field.expectedSha256Path);
        for (const [index, candidate] of paths.entries()) {
            if (typeof candidate !== "string") {
                throw diagnostic("HENOSIS_RESOURCE_FILE_REF", `Resource ${quoted(address)} file field ${quoted(field.path)} is not a string.`, "Supply a repository-relative native file path.");
            }
            assertRepositoryPath(candidate, `resource ${address} native ${field.kind}`);
            const expectedDigest = expected[index];
            if (expectedDigest !== undefined && (typeof expectedDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(expectedDigest))) {
                throw diagnostic("HENOSIS_FILE_DIGEST", `Resource ${quoted(address)} has an invalid expected digest at ${quoted(field.expectedSha256Path ?? "")}.`, "Use sha256 followed by 64 lowercase hexadecimal digits, or omit the digest.");
            }
            const closure = closureFiles.get(candidate);
            if (closure !== undefined && expectedDigest !== undefined && closure.sha256 !== expectedDigest) {
                throw diagnostic("HENOSIS_FILE_DIGEST", `Resource ${quoted(address)} expected ${expectedDigest} for ${quoted(candidate)}, but the closure contains ${closure.sha256}.`, "Update the expected digest or restore the intended file bytes.");
            }
            references.push(Object.freeze({
                path: candidate,
                kind: field.kind,
                ...(closure === undefined || field.kind === "directory" ? {} : { sha256: closure.sha256 }),
            }));
        }
    }
    return Object.freeze(references.sort((left, right) => compareCodeUnits(left.path, right.path)));
}
function valuesAtPath(root, pointer) {
    const segments = pointer.split("/").slice(1).map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
    let values = [root];
    for (const segment of segments) {
        const next = [];
        for (const value of values) {
            if (segment === "*") {
                if (Array.isArray(value))
                    next.push(...value);
            }
            else if (value !== null && typeof value === "object" && !Array.isArray(value) && segment in value) {
                next.push(value[segment]);
            }
        }
        values = next;
    }
    return values;
}
function metadata(definition, files) {
    return Object.freeze({
        name: definition.name,
        inputs: Object.freeze(Object.fromEntries(Object.entries(definition.inputs).map(([name, declaration]) => {
            if (declaration.kind === "output") {
                return [name, Object.freeze({ component: declaration.source.component, output: declaration.source.output, optional: declaration.optional })];
            }
            const config = {
                source: "config",
                schema: schemaWire(declaration.schema),
                ...(declaration.default === undefined ? {} : { default: Object.freeze({ value: snapshotJson(declaration.default, `default for config input ${name}`) }) }),
            };
            return [name, Object.freeze(config)];
        }))),
        outputs: Object.freeze(Object.fromEntries(Object.entries(definition.outputs).map(([name, declaration]) => [name, Object.freeze({ availability: declaration.availability, optional: declaration.optional, schema: schemaWire(declaration.schema) })]))),
        files,
    });
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
        case "array": {
            if (!Array.isArray(candidate))
                fail("array");
            for (const child of candidate) {
                assertSchemaValue(makeSchema(wire.element), child, label);
            }
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
function sourceLabel(name, declaration) {
    return declaration.kind === "output"
        ? `${declaration.source.component}.${declaration.source.output}`
        : `graph config ${name}`;
}
function assertKind(kind) { if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*@[1-9][0-9]*$/u.test(kind))
    throw diagnostic("HENOSIS_RESOURCE_KIND", `Invalid resource kind ${quoted(kind)}.`, "Use a versioned kind such as cloudflare/worker@1."); }
function assertRepositoryPath(path, label) {
    if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
        throw diagnostic("HENOSIS_FILE_PATH", `Invalid ${label} path ${quoted(path)}.`, "Use a normalized repository-relative path without empty, dot, parent, or backslash segments.");
    }
}
function assertTargetName(name, label) { if (!/^[a-z][a-z0-9_-]{0,62}$/u.test(name))
    throw diagnostic("HENOSIS_LOGICAL_NAME", `Invalid ${label} ${quoted(name)}.`, "Resource logical names and component names flow into target identifiers. Use 1-63 lowercase letters, digits, underscores, or hyphens, beginning with a letter."); }
function assertApiName(name, label) { if (!/^[A-Za-z][A-Za-z0-9]{0,62}$/u.test(name))
    throw diagnostic("HENOSIS_API_NAME", `Invalid ${label} ${quoted(name)}.`, "Input and output names are TypeScript API surface. Use 1-63 ASCII letters or digits, beginning with a letter; idiomatic camelCase is recommended."); }
function diagnostic(code, summary, help) { return new AuthoringError(code, summary, help); }
function quoted(value) { return JSON.stringify(value); }
function jsonKind(input) { return input === null ? "null" : Array.isArray(input) ? "array" : typeof input; }
function isRecord(input) { return typeof input === "object" && input !== null; }
function sorted(values) { return Object.freeze([...values].sort(compareCodeUnits)); }
//# sourceMappingURL=sdk.js.map