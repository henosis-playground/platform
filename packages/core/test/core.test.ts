import { describe, expect, it } from "vitest";
import {
  PipelineError,
  definePlatform,
  evaluateWorld,
  getComponentDefinition,
  h,
  inspectWorldPlatform,
  isLegacyPreviewEnvironmentName,
  isRef,
  parseEnvironmentName,
  refOutputPath,
  refSourceDefinition,
  representativePreviewName,
  typeIdFromUuid,
  uuidFromTypeId,
  type BuildContext,
  type ComponentModule,
  type ContextOutcome,
  type DeferredJsonValue,
  type Environment,
  type ImportedComponent,
  type ObjectSchema,
  type RecordSink,
  type Ref,
  type SchemaShape,
  type WorldPlan,
} from "../src/index.js";

const stableEnvKinds = ["dev", "prod"] as const;
type StableKind = (typeof stableEnvKinds)[number];
type TestEnv = Environment<StableKind>;
type TestContext = BuildContext<TestEnv> & {
  emit(value: DeferredJsonValue): void;
};

function origin(name: string, platformPath = "/platform/one"): ImportedComponent["origin"] {
  return {
    componentPackage: `@henosis/${name}`,
    componentPath: `/components/${name}/src/index.ts`,
    platformPath,
  };
}

function plan(
  components: Readonly<Record<string, ComponentModule<ObjectSchema<SchemaShape>>>>,
  opts: {
    env?: TestEnv;
    changed?: readonly string[];
    dependencies?: Readonly<Record<string, readonly string[]>>;
  } = {},
): WorldPlan<StableKind> {
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
    createContext: ({ env, image, records }): TestContext => ({
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

  it("widens inferred rows while selecting exactly one environment row", () => {
    const component = platform.defineComponent({
      outputs: h.object({ endpoint: h.url(), replicas: h.number() }),
      params: {
        dev: { host: "dev.example", replicas: 1 },
        prod: { host: "prod.example", replicas: 3 },
        preview: { host: "preview.example", replicas: 1 },
      },
      build: (ctx, params) => {
        const row: { host: string; replicas: number } = params;
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
    let retained: RecordSink | undefined;
    const outcomes: ContextOutcome[] = [];
    const platform = definePlatform({
      identity: {
        packageName: "@henosis/lifecycle",
        packageVersion: "1.0.0",
        apiVersion: 2,
      },
      stableEnvKinds,
      createContext: ({ env, image, records }): TestContext => {
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
    expect(() => retained?.write({ kind: "late", data: null })).toThrow(
      "Record transaction is sealed",
    );
  });

  it.each([
    {
      label: "build",
      expectedStage: "build" as const,
      buildValue: "throw" as const,
      finishThrows: false,
    },
    {
      label: "pending output validation",
      expectedStage: "pending-output-validation" as const,
      buildValue: "invalid" as const,
      finishThrows: false,
    },
    {
      label: "finish records",
      expectedStage: "finish-records" as const,
      buildValue: "valid" as const,
      finishThrows: true,
    },
  ])("aborts and disposes exactly once after a $label failure", (testCase) => {
    const outcomes: ContextOutcome[] = [];
    let retained: RecordSink | undefined;
    const platform = definePlatform({
      identity: {
        packageName: "@henosis/lifecycle",
        packageVersion: "1.0.0",
        apiVersion: 2,
      },
      stableEnvKinds,
      createContext: ({ env, image, records }): TestContext => {
        retained = records;
        return {
          env,
          image,
          emit: (value) => records.write({ kind: "partial", data: value }),
        };
      },
      finishRecords: () => {
        if (testCase.finishThrows) throw new Error("finish exploded");
      },
      dispose: (_ctx, outcome) => outcomes.push(outcome),
    });
    const component = platform.defineComponent({
      outputs: h.object({ value: h.string() }),
      build: (ctx) => {
        ctx.emit({ before: "failure" });
        if (testCase.buildValue === "throw") throw new Error("build exploded");
        return {
          value: testCase.buildValue === "invalid" ? 42 : "ready",
        } as never;
      },
    });

    let caught: unknown;
    try {
      evaluateWorld(plan({ sample: component }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PipelineError);
    expect((caught as PipelineError).failure).toMatchObject({
      stage: testCase.expectedStage,
      component: "sample",
    });
    expect(outcomes).toEqual([
      { status: "aborted", stage: testCase.expectedStage },
    ]);
    expect(() => retained?.write({ kind: "late", data: null })).toThrow(
      "Record transaction is aborted",
    );
  });
});

describe("borrowing and core-owned resolution", () => {
  const projected: Array<{ component: string; records: unknown }> = [];
  const platform = definePlatform({
    identity: {
      packageName: "@henosis/borrow-platform",
      packageVersion: "1.0.0",
      apiVersion: 2,
    },
    stableEnvKinds,
    createContext: ({ env, image, records }): TestContext => ({
      env,
      image,
      emit: (value) => records.write({ kind: "test", data: value }),
    }),
    project: ({ componentName, records }) => {
      projected.push({ component: componentName, records });
      return [{ path: "records.json", contents: JSON.stringify(records) }];
    },
  });

  function component(name: string, dependency?: Ref<string>) {
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
    const result = evaluateWorld(
      plan(
        { a: serviceA, b: serviceB, c: serviceC },
        {
          env: { kind: "preview", id: representativePreviewName },
          changed: ["a"],
          dependencies: { a: [], b: ["a"], c: [] },
        },
      ),
    );

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
    const result = evaluateWorld(
      plan(
        { producer, consumer },
        { dependencies: { producer: [], consumer: ["producer"] } },
      ),
    );

    expect(result.components.consumer?.records).toEqual([
      {
        kind: "test",
        data: { dependency: "https://producer-dev.example" },
      },
    ]);
    expect(result.components.consumer?.artifacts[0]?.contents).toContain(
      "https://producer-dev.example",
    );
  });
});

describe("platform discovery and environment grammar", () => {
  function platform(packageVersion: string, packageName = "@henosis/discovery") {
    return definePlatform({
      identity: { packageName, packageVersion, apiVersion: 2 },
      stableEnvKinds,
      createContext: ({ env, image }) => ({ env, image }),
    });
  }

  function imported(
    name: string,
    component: ComponentModule<ObjectSchema<SchemaShape>>,
    platformPath: string,
  ): ImportedComponent {
    return { name, component, origin: origin(name, platformPath) };
  }

  it("discovers a frozen descriptor from defaults and diagnoses duplicates/mixes", () => {
    const first = platform("1.0.0");
    const duplicate = platform("1.0.0");
    const mixed = platform("2.0.0");
    const make = (bound: typeof first) =>
      bound.defineComponent({
        outputs: h.object({ value: h.string() }),
        build: () => ({ value: "ok" }),
      });

    expect(
      inspectWorldPlatform([imported("a", make(first), "/p/one")]),
    ).toEqual({
      identity: {
        packageName: "@henosis/discovery",
        packageVersion: "1.0.0",
        apiVersion: 2,
      },
      stableEnvKinds: ["dev", "prod"],
    });
    expect(() =>
      inspectWorldPlatform([
        imported("a", make(first), "/p/one"),
        imported("b", make(duplicate), "/p/two"),
      ]),
    ).toThrow(/duplicate platform installation.*\/p\/one.*\/p\/two/);
    expect(() =>
      inspectWorldPlatform([
        imported("a", make(first), "/p/one"),
        imported("b", make(mixed), "/p/two"),
      ]),
    ).toThrow(/mixed platforms.*1\.0\.0.*2\.0\.0/);
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
    expect(() => parseEnvironmentName(stableEnvKinds, "staging")).toThrow(
      "Invalid canonical TypeID",
    );
    expect(() =>
      parseEnvironmentName(stableEnvKinds, representativePreviewName.toUpperCase()),
    ).toThrow("Invalid canonical TypeID");
  });
});
