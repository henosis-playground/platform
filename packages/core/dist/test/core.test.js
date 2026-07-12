import { describe, expect, it } from "vitest";
import { PipelineError, definePlatform, evaluateWorld, getComponentDefinition, h, inspectWorldPlatform, isLegacyPreviewEnvironmentName, isRef, parseEnvironmentName, refOutputPath, refSourceDefinition, representativePreviewName, typeIdFromUuid, uuidFromTypeId, } from "../src/index.js";
const stableEnvKinds = ["dev", "prod"];
function origin(name, platformPath = "/platform/one") {
    return {
        componentPackage: `@henosis/${name}`,
        componentPath: `/components/${name}/src/index.ts`,
        platformPath,
    };
}
function plan(components, opts = {}) {
    return {
        requestedEnv: opts.env ?? { kind: "dev" },
        components: Object.entries(components).map(([name, component]) => ({
            name,
            component,
            origin: origin(name),
            image: { ref: `${name}-ref`, digest: `sha256:${name}` },
        })),
        dependencies: opts.dependencies ?? {},
        changed: opts.changed ?? Object.keys(components),
    };
}
describe("component definition and exact params", () => {
    const platform = definePlatform({
        identity: {
            packageName: "@henosis/test-platform",
            packageVersion: "1.0.0",
            apiVersion: 2,
        },
        stableEnvKinds,
        createContext: ({ env, image, records }) => ({
            env,
            image,
            emit: (value) => records.write({ kind: "test", data: value }),
        }),
    });
    it("exports output refs whose immutable source is the definition object", () => {
        const component = platform.defineComponent({
            outputs: h.object({
                api: h.url(),
                nested: h.object({ label: h.string() }),
            }),
            build: () => ({
                api: "https://service.example",
                nested: { label: "ready" },
            }),
        });
        expect(Object.keys(component)).toEqual(["api", "nested"]);
        expect(isRef(component.api)).toBe(true);
        expect(refSourceDefinition(component.api)).toBe(getComponentDefinition(component));
        expect(refOutputPath(component.nested.label)).toEqual(["nested", "label"]);
    });
    it("keeps UI role metadata on the named output schema", () => {
        const role = "ui";
        const options = { role };
        const component = platform.defineComponent({
            outputs: h.object({ app: h.url(options), api: h.url() }),
            build: () => ({
                app: "https://service.example/app",
                api: "https://service.example/api",
            }),
        });
        const outputs = getComponentDefinition(component).outputs;
        expect(outputs.shape.app).toMatchObject({ kind: "url", role: "ui" });
        expect(outputs.shape.api).toEqual(expect.not.objectContaining({ role: expect.anything() }));
    });
    it("widens inferred rows while selecting exactly one environment row", () => {
        const component = platform.defineComponent({
            outputs: h.object({ endpoint: h.url(), replicas: h.number() }),
            params: {
                dev: { host: "dev.example", replicas: 1 },
                prod: { host: "prod.example", replicas: 3 },
                preview: { host: "preview.example", replicas: 1 },
            },
            build: (ctx, params) => {
                const row = params;
                ctx.emit({ host: row.host });
                return {
                    endpoint: `https://${row.host}`,
                    replicas: row.replicas,
                };
            },
        });
        expect(evaluateWorld(plan({ sample: component })).components.sample).toMatchObject({
            outputs: { endpoint: "https://dev.example", replicas: 1 },
            records: [{ kind: "test", data: { host: "dev.example" } }],
        });
    });
});
describe("transactional lifecycle", () => {
    it("seals successful sinks, rejects retained writes, and disposes exactly once", () => {
        let retained;
        const outcomes = [];
        const platform = definePlatform({
            identity: {
                packageName: "@henosis/lifecycle",
                packageVersion: "1.0.0",
                apiVersion: 2,
            },
            stableEnvKinds,
            createContext: ({ env, image, records }) => {
                retained = records;
                return {
                    env,
                    image,
                    emit: (value) => records.write({ kind: "build", data: value }),
                };
            },
            finishRecords: (_ctx, records) => {
                records.write({ kind: "finish", data: { ok: true } });
            },
            dispose: (_ctx, outcome) => outcomes.push(outcome),
        });
        const component = platform.defineComponent({
            outputs: h.object({ value: h.string() }),
            build: (ctx) => {
                ctx.emit({ value: "ready" });
                return { value: "ready" };
            },
        });
        expect(evaluateWorld(plan({ sample: component })).components.sample?.records).toEqual([
            { kind: "build", data: { value: "ready" } },
            { kind: "finish", data: { ok: true } },
        ]);
        expect(outcomes).toEqual([{ status: "sealed" }]);
        expect(() => retained?.write({ kind: "late", data: null })).toThrow("Record transaction is sealed");
    });
    it.each([
        {
            label: "build",
            expectedStage: "build",
            buildValue: "throw",
            finishThrows: false,
        },
        {
            label: "pending output validation",
            expectedStage: "pending-output-validation",
            buildValue: "invalid",
            finishThrows: false,
        },
        {
            label: "finish records",
            expectedStage: "finish-records",
            buildValue: "valid",
            finishThrows: true,
        },
    ])("aborts and disposes exactly once after a $label failure", (testCase) => {
        const outcomes = [];
        let retained;
        const platform = definePlatform({
            identity: {
                packageName: "@henosis/lifecycle",
                packageVersion: "1.0.0",
                apiVersion: 2,
            },
            stableEnvKinds,
            createContext: ({ env, image, records }) => {
                retained = records;
                return {
                    env,
                    image,
                    emit: (value) => records.write({ kind: "partial", data: value }),
                };
            },
            finishRecords: () => {
                if (testCase.finishThrows)
                    throw new Error("finish exploded");
            },
            dispose: (_ctx, outcome) => outcomes.push(outcome),
        });
        const component = platform.defineComponent({
            outputs: h.object({ value: h.string() }),
            build: (ctx) => {
                ctx.emit({ before: "failure" });
                if (testCase.buildValue === "throw")
                    throw new Error("build exploded");
                return {
                    value: testCase.buildValue === "invalid" ? 42 : "ready",
                };
            },
        });
        let caught;
        try {
            evaluateWorld(plan({ sample: component }));
        }
        catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(PipelineError);
        expect(caught.failure).toMatchObject({
            stage: testCase.expectedStage,
            component: "sample",
        });
        expect(outcomes).toEqual([
            { status: "aborted", stage: testCase.expectedStage },
        ]);
        expect(() => retained?.write({ kind: "late", data: null })).toThrow("Record transaction is aborted");
    });
    it("preserves the primary failure when dispose also throws", () => {
        const platform = definePlatform({
            identity: {
                packageName: "@henosis/lifecycle",
                packageVersion: "1.0.0",
                apiVersion: 2,
            },
            stableEnvKinds,
            createContext: ({ env, image }) => ({ env, image }),
            dispose: () => {
                throw new Error("dispose exploded");
            },
        });
        const component = platform.defineComponent({
            outputs: h.object({ value: h.string() }),
            build: () => {
                throw new Error("build exploded");
            },
        });
        let caught;
        try {
            evaluateWorld(plan({ sample: component }));
        }
        catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(PipelineError);
        expect(caught.failure).toEqual({
            stage: "build",
            component: "sample",
            message: "build exploded; dispose also failed: dispose exploded",
        });
    });
    it("snapshots record payloads and outputs before sealed disposal", () => {
        const payload = { nested: { value: "before" }, values: ["before"] };
        const outputs = { nested: { value: "before" } };
        const platform = definePlatform({
            identity: {
                packageName: "@henosis/lifecycle",
                packageVersion: "1.0.0",
                apiVersion: 2,
            },
            stableEnvKinds,
            createContext: ({ env, image, records }) => ({ env, image, records }),
            dispose: (_ctx, outcome) => {
                if (outcome.status === "sealed") {
                    payload.nested.value = "after-seal";
                    payload.values[0] = "after-seal";
                    outputs.nested.value = "after-seal";
                }
            },
        });
        const component = platform.defineComponent({
            outputs: h.object({ nested: h.object({ value: h.string() }) }),
            build: (ctx) => {
                ctx.records.write({ kind: "payload", data: payload });
                return outputs;
            },
        });
        const result = evaluateWorld(plan({
            sample: component,
        })).components.sample;
        expect(result?.outputs).toEqual({ nested: { value: "before" } });
        expect(result?.records).toEqual([
            {
                kind: "payload",
                data: { nested: { value: "before" }, values: ["before"] },
            },
        ]);
        expect(Object.isFrozen(result?.outputs)).toBe(true);
        expect(Object.isFrozen(result?.records)).toBe(true);
        expect(Object.isFrozen(result?.records[0]?.data)).toBe(true);
        expect(Object.isFrozen((result?.records[0]?.data).values)).toBe(true);
    });
    it("freezes resolved state before validators and projection", () => {
        let projected = "";
        const platform = definePlatform({
            identity: {
                packageName: "@henosis/lifecycle",
                packageVersion: "1.0.0",
                apiVersion: 2,
            },
            stableEnvKinds,
            createContext: ({ env, image, records }) => ({ env, image, records }),
            validators: [
                {
                    id: "mutation.probe",
                    validate: (world) => {
                        const component = world.components.sample;
                        const outputs = component?.outputs;
                        const record = component?.records[0]?.data;
                        expect(Reflect.set(outputs.nested, "value", "validator-mutated")).toBe(false);
                        expect(Reflect.set(record.nested, "value", "validator-mutated")).toBe(false);
                        return [];
                    },
                },
            ],
            project: ({ records }) => {
                projected = JSON.stringify(records);
                return [{ path: "records.json", contents: projected }];
            },
        });
        const component = platform.defineComponent({
            outputs: h.object({ nested: h.object({ value: h.string() }) }),
            build: (ctx) => {
                ctx.records.write({
                    kind: "payload",
                    data: { nested: { value: "before" } },
                });
                return { nested: { value: "before" } };
            },
        });
        const result = evaluateWorld(plan({
            sample: component,
        })).components.sample;
        expect(result?.outputs).toEqual({ nested: { value: "before" } });
        expect(projected).toContain('"value":"before"');
        expect(projected).not.toContain("validator-mutated");
    });
});
describe("borrowing and core-owned resolution", () => {
    const projected = [];
    const platform = definePlatform({
        identity: {
            packageName: "@henosis/borrow-platform",
            packageVersion: "1.0.0",
            apiVersion: 2,
        },
        stableEnvKinds,
        createContext: ({ env, image, records }) => ({
            env,
            image,
            emit: (value) => records.write({ kind: "test", data: value }),
        }),
        project: ({ componentName, records }) => {
            projected.push({ component: componentName, records });
            return [{ path: "records.json", contents: JSON.stringify(records) }];
        },
    });
    function component(name, dependency) {
        return platform.defineComponent({
            outputs: h.object({ endpoint: h.url() }),
            borrowForPreview: "dev",
            params: {
                dev: { suffix: "dev" },
                prod: { suffix: "prod" },
                preview: { suffix: "preview" },
            },
            build: (ctx, params) => {
                ctx.emit({ dependency: dependency ?? "none" });
                return {
                    endpoint: dependency ?? `https://${name}-${params.suffix}.example`,
                };
            },
        });
    }
    it("never borrows a changed member or transitive reverse-dependent", () => {
        projected.length = 0;
        const serviceA = component("a");
        const serviceB = component("b", serviceA.endpoint);
        const serviceC = component("c");
        const result = evaluateWorld(plan({ a: serviceA, b: serviceB, c: serviceC }, {
            env: { kind: "preview", id: representativePreviewName },
            changed: ["a"],
            dependencies: { a: [], b: ["a"], c: [] },
        }));
        expect(result.components.a?.disposition).toEqual({ kind: "materialized" });
        expect(result.components.b?.disposition).toEqual({ kind: "materialized" });
        expect(result.components.c).toMatchObject({
            effectiveEnv: { kind: "dev" },
            disposition: {
                kind: "borrowed",
                from: "dev",
                effectiveEnv: { kind: "dev" },
            },
            outputs: { endpoint: "https://c-dev.example" },
            records: [],
            artifacts: [],
        });
        expect(projected.map((entry) => entry.component)).toEqual(["a", "b"]);
    });
    it("resolves a definition-identity Ref in records before projection", () => {
        projected.length = 0;
        const producer = component("producer");
        const consumer = component("consumer", producer.endpoint);
        const result = evaluateWorld(plan({ producer, consumer }, { dependencies: { producer: [], consumer: ["producer"] } }));
        expect(result.components.consumer?.records).toEqual([
            {
                kind: "test",
                data: { dependency: "https://producer-dev.example" },
            },
        ]);
        expect(result.components.consumer?.artifacts[0]?.contents).toContain("https://producer-dev.example");
    });
});
describe("world validator canonicalization", () => {
    it("sorts by help and deduplicates a canonical field tuple", () => {
        const platform = definePlatform({
            identity: {
                packageName: "@henosis/validator-platform",
                packageVersion: "1.0.0",
                apiVersion: 2,
            },
            stableEnvKinds,
            createContext: ({ env, image }) => ({ env, image }),
            validators: [
                {
                    id: "canonical.probe",
                    validate: () => [
                        {
                            code: "canonical.issue",
                            message: "same message",
                            component: "sample",
                            help: "z-last",
                        },
                        {
                            component: "sample",
                            help: "z-last",
                            message: "same message",
                            code: "canonical.issue",
                        },
                        {
                            code: "canonical.issue",
                            message: "same message",
                            component: "sample",
                            help: "a-first",
                        },
                    ],
                },
            ],
        });
        const component = platform.defineComponent({
            outputs: h.object({ value: h.string() }),
            build: () => ({ value: "ok" }),
        });
        let caught;
        try {
            evaluateWorld(plan({ sample: component }));
        }
        catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(PipelineError);
        expect(caught.failure.issues?.map((issue) => issue.help))
            .toEqual(["a-first", "z-last"]);
    });
});
describe("platform discovery and environment grammar", () => {
    function platform(packageVersion, packageName = "@henosis/discovery") {
        return definePlatform({
            identity: { packageName, packageVersion, apiVersion: 2 },
            stableEnvKinds,
            createContext: ({ env, image }) => ({ env, image }),
        });
    }
    function imported(name, component, platformPath) {
        return { name, component, origin: origin(name, platformPath) };
    }
    it("discovers a frozen descriptor from defaults and diagnoses duplicates/mixes", () => {
        const first = platform("1.0.0");
        const duplicate = platform("1.0.0");
        const mixed = platform("2.0.0");
        const make = (bound) => bound.defineComponent({
            outputs: h.object({ value: h.string() }),
            build: () => ({ value: "ok" }),
        });
        expect(inspectWorldPlatform([imported("a", make(first), "/p/one")])).toEqual({
            identity: {
                packageName: "@henosis/discovery",
                packageVersion: "1.0.0",
                apiVersion: 2,
            },
            stableEnvKinds: ["dev", "prod"],
        });
        expect(() => inspectWorldPlatform([
            imported("a", make(first), "/p/one"),
            imported("b", make(duplicate), "/p/two"),
        ])).toThrow(/duplicate platform installation.*\/p\/one.*\/p\/two/);
        expect(() => inspectWorldPlatform([
            imported("a", make(first), "/p/one"),
            imported("b", make(mixed), "/p/two"),
        ])).toThrow(/mixed platforms: component a carries @henosis\/discovery@1\.0\.0.*component b carries @henosis\/discovery@2\.0\.0/);
    });
    it("strictly parses TypeIDs, retains only the marked legacy shim, and roundtrips the representative", () => {
        const uuid = "728b0fd3-0c7f-4202-843f-f78b16bc3d04";
        expect(typeIdFromUuid("preview", uuid)).toBe(representativePreviewName);
        expect(uuidFromTypeId(representativePreviewName, "preview")).toBe(uuid);
        expect(parseEnvironmentName(stableEnvKinds, representativePreviewName)).toEqual({
            kind: "preview",
            id: representativePreviewName,
        });
        expect(isLegacyPreviewEnvironmentName("preview-legacy-42")).toBe(true);
        expect(parseEnvironmentName(stableEnvKinds, "preview-legacy-42")).toEqual({
            kind: "preview",
            id: "preview-legacy-42",
        });
        expect(() => parseEnvironmentName(stableEnvKinds, "staging")).toThrow("Unknown environment");
        expect(() => parseEnvironmentName(stableEnvKinds, representativePreviewName.toUpperCase())).toThrow("Unknown environment");
    });
    it("matches official TypeID vectors in the supported prefixed subset", () => {
        const vectors = [
            {
                typeId: "prefix_0123456789abcdefghjkmnpqrs",
                prefix: "prefix",
                uuid: "0110c853-1d09-52d8-d73e-1194e95b5f19",
            },
            {
                typeId: "prefix_01h455vb4pex5vsknk084sn02q",
                prefix: "prefix",
                uuid: "01890a5d-ac96-774b-bcce-b302099a8057",
            },
            {
                typeId: "pre_fix_00000000000000000000000000",
                prefix: "pre_fix",
                uuid: "00000000-0000-0000-0000-000000000000",
            },
        ];
        for (const vector of vectors) {
            expect(typeIdFromUuid(vector.prefix, vector.uuid)).toBe(vector.typeId);
            expect(uuidFromTypeId(vector.typeId, vector.prefix)).toBe(vector.uuid);
        }
        expect(() => typeIdFromUuid("pre1", vectors[0].uuid)).toThrow("Invalid TypeID prefix");
        expect(() => typeIdFromUuid("", vectors[0].uuid)).toThrow("Invalid TypeID prefix");
        expect(() => uuidFromTypeId("prefix_8zzzzzzzzzzzzzzzzzzzzzzzzz", "prefix")).toThrow("Invalid canonical TypeID");
    });
});
//# sourceMappingURL=core.test.js.map