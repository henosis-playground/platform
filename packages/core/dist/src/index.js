import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const componentDefinitionSymbol = Symbol.for("henosis.component");
const schemaSymbol = Symbol.for("henosis.schema");
const refSymbol = Symbol.for("henosis.ref");
export const h = {
    object(shape) {
        return makeObjectSchema(shape);
    },
    string() {
        return makeLeafSchema("string");
    },
    url() {
        return makeLeafSchema("url");
    },
    number() {
        return makeLeafSchema("number");
    },
};
export function envName(env) {
    return env.kind === "preview" ? env.id : env.kind;
}
export function envFromName(name) {
    if (name === "dev" || name === "staging" || name === "prod") {
        return { kind: name };
    }
    return { kind: "preview", id: name };
}
export function defineComponent(spec) {
    assertValidOutputNames(spec.outputs);
    const definition = {
        outputs: spec.outputs,
        build: spec.build,
        componentName: inferComponentName(),
    };
    const refs = makeRefObject(spec.outputs, definition, []);
    Object.defineProperty(refs, componentDefinitionSymbol, {
        enumerable: false,
        configurable: false,
        value: definition,
    });
    return refs;
}
export function getComponentDefinition(component) {
    return component[componentDefinitionSymbol];
}
export function isComponentModule(value) {
    return (isRecord(value) &&
        componentDefinitionSymbol in value &&
        isComponentDefinition(value[componentDefinitionSymbol]));
}
export function bindComponentIdentity(component, componentName) {
    assertComponentName(componentName);
    component[componentDefinitionSymbol].componentName = componentName;
}
export function evaluateComponent(component, opts) {
    const ctx = {
        env: opts.env,
        image: opts.image,
    };
    const definition = component[componentDefinitionSymbol];
    return {
        outputs: definition.build(ctx, opts.env),
        records: [],
        artifacts: [],
    };
}
export function validateSchema(schema, value, opts = {}) {
    return validateAgainstSchema(schema, value, [], opts.allowRefs === true);
}
export function isRef(value) {
    return isRecord(value) && refSymbol in value && isOutputRefData(value[refSymbol]);
}
export function refSourceComponent(value) {
    return value[refSymbol].source.componentName;
}
export function refOutputPath(value) {
    return value[refSymbol].path;
}
function makeLeafSchema(kind) {
    return Object.freeze({
        kind,
        [schemaSymbol]: { kind },
    });
}
function makeObjectSchema(shape) {
    return Object.freeze({
        kind: "object",
        shape,
        [schemaSymbol]: { kind: "object", shape },
    });
}
function makeRefObject(schema, source, prefix) {
    const refs = Object.create(null);
    for (const [key, child] of Object.entries(schema.shape)) {
        if (isObjectSchema(child)) {
            refs[key] = makeRefObject(child, source, [...prefix, key]);
        }
        else {
            refs[key] = makeRef(source, [...prefix, key]);
        }
    }
    return refs;
}
function makeRef(source, outputPath) {
    return Object.freeze({
        [refSymbol]: {
            source,
            path: outputPath,
        },
    });
}
function validateAgainstSchema(schema, value, pathParts, allowRefs) {
    if (allowRefs && isRef(value)) {
        return [];
    }
    const data = getSchemaData(schema);
    switch (data.kind) {
        case "string":
            return typeof value === "string"
                ? []
                : [issue(pathParts, "string", actualType(value))];
        case "url":
            return typeof value === "string" && isUrl(value)
                ? []
                : [issue(pathParts, "url", actualType(value))];
        case "number":
            return typeof value === "number"
                ? []
                : [issue(pathParts, "number", actualType(value))];
        case "object":
            return validateObject(data.shape ?? {}, value, pathParts, allowRefs);
    }
}
function validateObject(shape, value, pathParts, allowRefs) {
    if (!isRecord(value)) {
        return [issue(pathParts, "object", actualType(value))];
    }
    const issues = [];
    for (const [key, childSchema] of Object.entries(shape)) {
        if (!(key in value)) {
            issues.push(issue([...pathParts, key], schemaExpected(childSchema), "missing"));
            continue;
        }
        issues.push(...validateAgainstSchema(childSchema, value[key], [...pathParts, key], allowRefs));
    }
    return issues;
}
function assertValidOutputNames(schema, pathParts = []) {
    if (!isObjectSchema(schema)) {
        return;
    }
    for (const [name, child] of Object.entries(schema.shape)) {
        assertOutputName(name, [...pathParts, name]);
        assertValidOutputNames(child, [...pathParts, name]);
    }
}
function assertOutputName(name, pathParts) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        throw new Error(`Invalid component output name "${pathParts.join(".")}": output names must be dot-accessible identifiers`);
    }
    if (name === "__proto__" || name === "prototype" || name === "constructor") {
        throw new Error(`Invalid component output name "${pathParts.join(".")}": reserved object property names are not allowed`);
    }
}
function assertComponentName(name) {
    if (name.length === 0) {
        throw new Error("Component name must not be empty");
    }
}
function schemaExpected(schema) {
    return getSchemaData(schema).kind;
}
function getSchemaData(schema) {
    if (!isRecord(schema) || !(schemaSymbol in schema)) {
        throw new Error("Invalid Henosis schema");
    }
    const data = schema[schemaSymbol];
    if (!isSchemaData(data)) {
        throw new Error("Invalid Henosis schema");
    }
    return data;
}
function isObjectSchema(schema) {
    return getSchemaData(schema).kind === "object";
}
function isSchemaData(value) {
    if (!isRecord(value)) {
        return false;
    }
    if (value.kind === "object") {
        return value.shape === undefined || isRecord(value.shape);
    }
    return value.kind === "string" || value.kind === "url" || value.kind === "number";
}
function isComponentDefinition(value) {
    return (isRecord(value) &&
        "outputs" in value &&
        "build" in value &&
        typeof value.build === "function");
}
function isOutputRefData(value) {
    return (isRecord(value) &&
        isComponentDefinition(value.source) &&
        Array.isArray(value.path) &&
        value.path.every((part) => typeof part === "string"));
}
function issue(pathParts, expected, actual) {
    return { path: pathParts, expected, actual };
}
function actualType(value) {
    if (isRef(value)) {
        const source = refSourceComponent(value) ?? "unknown";
        return `ref(${source}.${refOutputPath(value).join(".")})`;
    }
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    if (typeof value === "string") {
        return isUrl(value) ? "url" : "string";
    }
    return typeof value;
}
function isUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    catch {
        return false;
    }
}
function inferComponentName() {
    const callsite = componentCallsiteFile();
    if (callsite === undefined) {
        return undefined;
    }
    let dir = path.dirname(callsite);
    while (dir !== path.dirname(dir)) {
        const packagePath = path.join(dir, "package.json");
        if (existsSync(packagePath)) {
            try {
                const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
                if (isRecord(parsed) && isRecord(parsed.henosis)) {
                    const component = parsed.henosis.component;
                    return typeof component === "string" ? component : undefined;
                }
            }
            catch {
                return undefined;
            }
        }
        dir = path.dirname(dir);
    }
    return undefined;
}
function componentCallsiteFile() {
    const stack = new Error().stack;
    if (stack === undefined) {
        return undefined;
    }
    const lines = stack.split(/\r?\n/).slice(1);
    for (const line of lines) {
        const filePath = stackLineFilePath(line);
        if (filePath === undefined) {
            continue;
        }
        const normalized = filePath.replaceAll("\\", "/");
        if (!normalized.includes("/@henosis/core/")) {
            return filePath;
        }
    }
    return undefined;
}
function stackLineFilePath(line) {
    const urlMatch = /(file:\/\/[^\s)]+):\d+:\d+/.exec(line);
    if (urlMatch !== null) {
        return fileURLToPath(urlMatch[1]);
    }
    const pathMatch = /(\S+):\d+:\d+\)?$/.exec(line);
    return pathMatch?.[1];
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=index.js.map