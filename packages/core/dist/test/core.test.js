import { describe, expect, it } from "vitest";
import { bindComponentIdentity, componentDefinitionSymbol, defineComponent, envFromName, envName, evaluateComponent, getComponentDefinition, h, isRef, refOutputPath, refSourceComponent, validateSchema, } from "../src/index.js";
describe("defineComponent", () => {
    it("exports only output refs as public properties", () => {
        const component = defineComponent({
            outputs: h.object({
                api: h.url(),
                nested: h.object({ label: h.string() }),
            }),
            build: () => ({
                api: "https://service-a-dev.henosis.example",
                nested: { label: "ready" },
            }),
        });
        bindComponentIdentity(component, "service-a");
        expect(Object.keys(component)).toEqual(["api", "nested"]);
        expect(component.api).toSatisfy(isRef);
        expect(component.nested.label).toSatisfy(isRef);
        expect(refSourceComponent(component.api)).toBe("service-a");
        expect(refOutputPath(component.nested.label)).toEqual(["nested", "label"]);
        expect(getComponentDefinition(component)).toBe(component[componentDefinitionSymbol]);
    });
    it("rejects degenerate output names loudly", () => {
        expect(() => defineComponent({
            outputs: h.object({
                "api-url": h.url(),
            }),
            build: () => ({
                "api-url": "https://service-a-dev.henosis.example",
            }),
        })).toThrow("dot-accessible identifiers");
        expect(() => defineComponent({
            outputs: h.object({
                constructor: h.string(),
            }),
            build: () => ({ constructor: "bad" }),
        })).toThrow("reserved object property names");
    });
    it("keeps output and ref types connected", () => {
        const producer = defineComponent({
            outputs: h.object({ api: h.url() }),
            build: () => ({ api: "https://service-a-dev.henosis.example" }),
        });
        defineComponent({
            outputs: h.object({
                app: h.url(),
                upstream: h.url(),
            }),
            build: () => {
                const upstream = producer.api;
                void upstream;
                // @ts-expect-error missing is not an output ref.
                void producer.missing;
                return {
                    app: "https://service-b-dev.henosis.example",
                    upstream: producer.api,
                };
            },
        });
    });
});
describe("evaluation and validation", () => {
    it("evaluates pure builds with ctx env and image", () => {
        const component = defineComponent({
            outputs: h.object({ api: h.url() }),
            build: (ctx, env) => ({
                api: `https://service-a-${envName(env)}-${ctx.image.digest.slice(7)}.henosis.example`,
            }),
        });
        const result = evaluateComponent(component, {
            env: envFromName("pr-test"),
            image: { ref: "service-a:pr-test", digest: "sha256:abc" },
        });
        expect(result).toEqual({
            outputs: {
                api: "https://service-a-pr-test-abc.henosis.example",
            },
            records: [],
            artifacts: [],
        });
    });
    it("narrows typed environment kinds", () => {
        const component = defineComponent({
            outputs: h.object({ api: h.url() }),
            build: (_ctx, env) => {
                const id = env.kind === "preview" ? env.id : env.kind;
                return { api: `https://service-a-${id}.henosis.example` };
            },
        });
        expect(evaluateComponent(component, {
            env: envFromName("dev"),
            image: { ref: "service-a:dev", digest: "sha256:abc" },
        }).outputs).toEqual({
            api: "https://service-a-dev.henosis.example",
        });
    });
    it("validates leaf schemas and permits refs before resolution", () => {
        const producer = defineComponent({
            outputs: h.object({ api: h.url() }),
            build: () => ({ api: "https://service-a-dev.henosis.example" }),
        });
        const schema = h.object({ upstream: h.url() });
        expect(validateSchema(schema, { upstream: producer.api }, { allowRefs: true })).toEqual([]);
        expect(validateSchema(schema, { upstream: "not a url" })).toEqual([
            { path: ["upstream"], expected: "url", actual: "string" },
        ]);
        expect(validateSchema(h.object({ port: h.number() }), { port: "5432" })).toEqual([
            { path: ["port"], expected: "number", actual: "string" },
        ]);
    });
});
//# sourceMappingURL=core.test.js.map