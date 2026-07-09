import { describe, expect, it } from "vitest";
import {
  bindComponentIdentity,
  componentDefinitionSymbol,
  definePlatform,
  evaluateComponent,
  getComponentDefinition,
  h,
  isRef,
  refOutputPath,
  refSourceComponent,
  runWorldValidators,
  validateSchema,
  type BuildContext,
  type ComponentArtifact,
  type ComponentRecord,
  type Env,
  type Ref,
} from "../src/index.js";

const stableEnvKinds = ["local", "production"] as const;
type TestStableEnvKind = (typeof stableEnvKinds)[number];
type TestEnv = Env<TestStableEnvKind>;
type TestContext = BuildContext<TestEnv> & {
  readonly emit: (label: string) => void;
};

const validatedWorlds: string[] = [];
const testPlatform = definePlatform<TestStableEnvKind, TestContext>({
  stableEnvKinds,
  createContext: ({ env, image, records }) => ({
    env,
    image,
    emit: (label) => records.write({ kind: "test", data: { label } }),
  }),
  finalize: (ctx, { artifacts }) => {
    artifacts.write({ path: "env.txt", contents: ctx.env.kind });
  },
  validators: [
    (world) => {
      validatedWorlds.push(world.env.kind);
    },
  ],
});

function evaluate<S extends ReturnType<typeof h.object>>(
  component: Parameters<typeof evaluateComponent<S, TestEnv>>[0],
  env: TestEnv,
): {
  outputs: ReturnType<typeof evaluateComponent<S, TestEnv>>["outputs"];
  records: ComponentRecord[];
  artifacts: ComponentArtifact[];
} {
  const records: ComponentRecord[] = [];
  const artifacts: ComponentArtifact[] = [];
  const result = evaluateComponent(component, {
    env,
    image: { ref: "test:ref", digest: "sha256:abc" },
    records: { write: (record) => records.push(record) },
    artifacts: { write: (artifact) => artifacts.push(artifact) },
  });
  return { ...result, records, artifacts };
}

describe("defineComponent", () => {
  it("exports only output refs as public properties", () => {
    const component = testPlatform.defineComponent({
      outputs: h.object({
        api: h.url(),
        nested: h.object({ label: h.string() }),
      }),
      build: () => ({
        api: "https://service-a-local.henosis.example",
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
    expect(() =>
      testPlatform.defineComponent({
        outputs: h.object({
          "api-url": h.url(),
        }),
        build: () => ({
          "api-url": "https://service-a-local.henosis.example",
        }),
      }),
    ).toThrow("dot-accessible identifiers");

    expect(() =>
      testPlatform.defineComponent({
        outputs: h.object({
          constructor: h.string(),
        }),
        build: () => ({ constructor: "bad" }),
      }),
    ).toThrow("reserved object property names");
  });

  it("keeps output and ref types connected", () => {
    const producer = testPlatform.defineComponent({
      outputs: h.object({ api: h.url() }),
      build: () => ({ api: "https://service-a-local.henosis.example" }),
    });

    testPlatform.defineComponent({
      outputs: h.object({
        app: h.url(),
        upstream: h.url(),
      }),
      build: () => {
        const upstream: Ref<string> = producer.api;
        void upstream;

        // @ts-expect-error missing is not an output ref.
        void producer.missing;

        return {
          app: "https://service-b-local.henosis.example",
          upstream: producer.api,
        };
      },
    });
  });
});

describe("generic platform evaluation", () => {
  it("selects an exhaustive params row and infers its legible row type", () => {
    const component = testPlatform.defineComponent({
      outputs: h.object({ endpoint: h.url(), replicas: h.number() }),
      params: {
        local: { host: "local.example", replicas: 1 },
        production: { host: "prod.example", replicas: 3 },
        preview: { host: "preview.example", replicas: 1 },
      },
      build: (ctx, params) => {
        const inferred: { host: string; replicas: number } = params;
        ctx.emit(inferred.host);
        return {
          endpoint: `https://${inferred.host}`,
          replicas: inferred.replicas,
        };
      },
    });

    expect(evaluate(component, { kind: "production" })).toEqual({
      outputs: { endpoint: "https://prod.example", replicas: 3 },
      records: [{ kind: "test", data: { label: "prod.example" } }],
      artifacts: [{ path: "env.txt", contents: "production" }],
    });
    expect(evaluate(component, { kind: "preview", id: "preview-42" }).outputs).toEqual({
      endpoint: "https://preview.example",
      replicas: 1,
    });
  });

  it("requires every stable kind and preview in params", () => {
    testPlatform.defineComponent({
      outputs: h.object({ value: h.string() }),
      // @ts-expect-error params must include the production row.
      params: {
        local: { value: "local" },
        preview: { value: "preview" },
      },
      build: (_ctx, params) => ({ value: params.value }),
    });
  });

  it("creates ctx before build, finalizes after build, and runs validators", () => {
    const component = testPlatform.defineComponent({
      outputs: h.object({ value: h.string() }),
      build: (ctx) => {
        ctx.emit(ctx.env.kind);
        return { value: ctx.env.kind };
      },
    });
    bindComponentIdentity(component, "sample");
    const evaluated = evaluate(component, { kind: "local" });

    expect(evaluated.records).toEqual([
      { kind: "test", data: { label: "local" } },
    ]);
    expect(evaluated.artifacts).toEqual([
      { path: "env.txt", contents: "local" },
    ]);

    validatedWorlds.length = 0;
    runWorldValidators([component], {
      env: { kind: "local" },
      components: { sample: evaluated.records },
    });
    expect(validatedWorlds).toEqual(["local"]);
  });

  it("generalizes env name parsing to the platform's stable set", () => {
    expect(testPlatform.envFromName("local")).toEqual({ kind: "local" });
    expect(testPlatform.envFromName("preview-special")).toEqual({
      kind: "preview",
      id: "preview-special",
    });
    expect(testPlatform.envName({ kind: "production" })).toBe("production");
  });
});

describe("validation", () => {
  it("validates leaf schemas and permits refs before resolution", () => {
    const producer = testPlatform.defineComponent({
      outputs: h.object({ api: h.url() }),
      build: () => ({ api: "https://service-a-local.henosis.example" }),
    });
    const schema = h.object({ upstream: h.url() });

    expect(validateSchema(schema, { upstream: producer.api }, { allowRefs: true })).toEqual(
      [],
    );
    expect(validateSchema(schema, { upstream: "not a url" })).toEqual([
      { path: ["upstream"], expected: "url", actual: "string" },
    ]);
    expect(validateSchema(h.object({ port: h.number() }), { port: "5432" })).toEqual([
      { path: ["port"], expected: "number", actual: "string" },
    ]);
  });
});
