import { describe, expect, it } from "vitest";
import {
  AuthoringError,
  Blocked,
  canonicalStringify,
  config,
  createBundle,
  defineComponent,
  defineResource,
  output,
  value,
  type BundleInputSources,
  type JsonValue,
} from "../src/index.js";
import { FakeHost } from "../src/testing.js";

const producer = defineComponent({
  name: "producer",
  outputs: {
    endpoint: output.observed(value.url()),
    preview: output.optionalObserved(value.url()),
  },
  build: () => {
    throw new Error("metadata-only fixture");
  },
});

const testResourceOutputs = {
  endpoint: output.observed(value.url()),
} as const;

const testResource = defineResource<
  { readonly message: JsonValue },
  typeof testResourceOutputs
>({
  kind: "test/message@1",
  outputs: testResourceOutputs,
});

const consumerInputs = {
  producerEndpoint: producer.outputs.endpoint,
  producerPreview: producer.outputs.preview,
} satisfies BundleInputSources;

function consumer() {
  return defineComponent({
    name: "consumer",
    config: {
      label: value.string().default("consumer"),
    },
    outputs: {
      label: output.static(value.string()),
      endpoint: output.observed(value.url()),
    },
    build(context) {
      context.emit(testResource.create("prefix", { message: "stable" }));
      const endpoint = producer.outputs.endpoint.value;
      const message = producer.outputs.preview.present
        ? `${endpoint} -> ${producer.outputs.preview.value}`
        : endpoint;
      const emitted = context.emit(testResource.create("final", { message }));
      return { label: context.config.label.value, endpoint: emitted.outputs.endpoint };
    },
  });
}

describe("restored authoring surface", () => {
  it("derives imported outputs and config into unchanged wire metadata", () => {
    const component = consumer();

    expect(createBundle(component, [], consumerInputs).component.inputs).toEqual({
      label: { source: "config", schema: { kind: "string" }, default: { value: "consumer" } },
      producerEndpoint: { component: "producer", output: "endpoint", optional: false },
      producerPreview: { component: "producer", output: "preview", optional: true },
    });
    expect(new FakeHost(component, [], consumerInputs)
      .available("producerEndpoint", "https://api.example")
      .absent("producerPreview")
      .run()).toMatchObject({
      status: "complete",
      outputs: { label: "consumer" },
      reads: ["label", "producerEndpoint"],
    });
  });

  it("evaluates imported handles directly and returns canonical total resources", () => {
    const result = new FakeHost(consumer(), [], consumerInputs)
      .available("producerEndpoint", "https://api.example")
      .absent("producerPreview")
      .run();

    expect(result).toMatchObject({
      status: "complete",
      observedOutputs: {
        endpoint: { resource: "test/message@1/final", output: "endpoint" },
      },
      reads: ["label", "producerEndpoint"],
    });
    expect(result.resources.map((resource) => resource.canonical)).toEqual([
      '{"message":"stable"}',
      '{"message":"https://api.example"}',
    ]);
  });

  it("keeps the deterministic emitted prefix when an imported output blocks", () => {
    const host = new FakeHost(consumer(), [], consumerInputs)
      .blocked("producerEndpoint")
      .absent("producerPreview");
    const blocked = host.run();

    expect(blocked).toMatchObject({
      status: "blocked",
      blocked: { input: "producerEndpoint", source: "producer.endpoint" },
      reads: ["producerEndpoint"],
    });
    expect(blocked.resources.map((resource) => resource.address)).toEqual([
      "test/message@1/prefix",
    ]);

    const complete = host.available("producerEndpoint", "https://api.example").run();
    expect(complete.status).toBe("complete");
    expect(complete.resources.map((resource) => resource.address)).toEqual([
      "test/message@1/prefix",
      "test/message@1/final",
    ]);
  });

  it("keeps sticky host blocking when component code catches Blocked", () => {
    const swallowing = defineComponent({
      name: "swallowing",
      outputs: { fabricatedValue: output.static(value.string()) },
      build(context) {
        try {
          producer.outputs.endpoint.value;
        } catch (error) {
          if (!(error instanceof Blocked)) throw error;
        }
        context.emit(testResource.create("fabricated", { message: "not actually complete" }));
        return { fabricatedValue: "fake" };
      },
    });

    expect(new FakeHost(swallowing, [], {
      producerEndpoint: producer.outputs.endpoint,
    }).blocked("producerEndpoint").run()).toMatchObject({
      status: "blocked",
      resources: [],
      blocked: { input: "producerEndpoint", source: "producer.endpoint" },
      reads: ["producerEndpoint"],
    });
  });

  it("branches on optional presence without reading or blocking", () => {
    const absent = new FakeHost(consumer(), [], consumerInputs)
      .available("producerEndpoint", "https://api.example")
      .absent("producerPreview")
      .run();
    expect(absent.reads).toEqual(["label", "producerEndpoint"]);

    const blocked = new FakeHost(consumer(), [], consumerInputs)
      .available("producerEndpoint", "https://api.example")
      .blocked("producerPreview")
      .run();
    expect(blocked).toMatchObject({
      status: "blocked",
      blocked: { input: "producerPreview", operation: "reading `.value`" },
      reads: ["producerEndpoint", "producerPreview"],
    });
  });

  it("evaluates a service-f-shaped fixture with derived wiring and artifacts", () => {
    const artifactSource = Symbol.for("henosis.artifact-source.v1");
    const workload = defineResource<
      { readonly source: { readonly entry: object }; readonly vars: { readonly BACKEND_URL: string } },
      typeof testResourceOutputs
    >({ kind: "test/workload@1", outputs: testResourceOutputs });
    const component = defineComponent({
      name: "workload",
      outputs: { url: output.observed(value.url()) },
      build(context) {
        const deployed = context.emit(workload.create("worker", {
          source: {
            entry: Object.freeze({
              [artifactSource]: Object.freeze({ kind: "cloudflare-worker", path: "workers/frontend.ts" }),
            }),
          },
          vars: { BACKEND_URL: producer.outputs.endpoint.value },
        }));
        return { url: deployed.outputs.endpoint };
      },
    });
    const digest = `sha256:${"ab".repeat(32)}` as const;
    const derived = {
      producerEndpoint: producer.outputs.endpoint,
      workerEntry: { source: "artifact", kind: "cloudflare-worker", path: "workers/frontend.ts" },
    } as const;

    expect(createBundle(component, [], derived).component.inputs).toEqual({
      producerEndpoint: { component: "producer", output: "endpoint", optional: false },
      workerEntry: { source: "config", schema: { kind: "artifact" } },
    });
    expect(new FakeHost(component, [], derived)
      .available("producerEndpoint", "https://api.example")
      .available("workerEntry", digest)
      .run()).toMatchObject({
      status: "complete",
      reads: ["producerEndpoint", "workerEntry"],
      observedOutputs: { url: { resource: "test/workload@1/worker", output: "endpoint" } },
      resources: [{
        body: {
          source: { entry: { kind: "cloudflare-worker", digest } },
          vars: { BACKEND_URL: "https://api.example" },
        },
      }],
    });
  });
});

describe("configuration closure", () => {
  it("resolves configuration-file references to bundler-computed digests", () => {
    const migrations = defineResource<
      { readonly migrations: readonly { readonly path: string; readonly sha256?: `sha256:${string}` }[] },
      Record<never, never>
    >({
      kind: "test/migrations@1",
      outputs: {},
      configFiles: [{ references: "/migrations/*", pathField: "path", digestField: "sha256" }],
    });
    const configured = defineComponent({
      name: "configured_files",
      files: [config.file("migrations/001.sql")],
      outputs: {},
      build(context) {
        context.emit(migrations.create("schema", { migrations: [{ path: "migrations/001.sql" }] }));
        return {};
      },
    });
    const digest = `sha256:${"ab".repeat(32)}` as const;

    expect(new FakeHost(configured, [{ path: "migrations/001.sql", sha256: digest }]).run())
      .toMatchObject({
        resources: [{ body: { migrations: [{ path: "migrations/001.sql", sha256: digest }] } }],
      });
    expect(() => createBundle(configured, [])).toThrow("omitted declared configuration file");
  });
});

describe("author diagnostics", () => {
  it("rejects imported handles placed into resources without .value", () => {
    const broken = defineComponent({
      name: "broken",
      outputs: { endpoint: output.observed(value.url()) },
      build(context) {
        const emitted = context.emit(testResource.create("bad", {
          message: producer.outputs.endpoint as unknown as JsonValue,
        }));
        return { endpoint: emitted.outputs.endpoint };
      },
    });

    expect(new FakeHost(broken, [], {
      producerEndpoint: producer.outputs.endpoint,
    }).blocked("producerEndpoint").run()).toMatchObject({
      status: "blocked",
      blocked: { operation: "serializing resource test/message@1/bad.message" },
    });
    expect(() => new FakeHost(broken, [], {
      producerEndpoint: producer.outputs.endpoint,
    }).available("producerEndpoint", "https://api.example").run())
      .toThrow("Imported output handle producer.outputs.endpoint was placed into resource");
  });

  it("rejects clock and randomness", () => {
    const clock = defineComponent({
      name: "clock",
      outputs: { value: output.static(value.number()) },
      build: () => ({ value: Date.now() }),
    });
    expect(() => new FakeHost(clock).run()).toThrow(AuthoringError);
    expect(() => new FakeHost(clock).run()).toThrow("Date.now() is unavailable");
  });
});

describe("under-specification monotonicity oracle", () => {
  it("every availability subset emits a prefix subset of full evaluation", () => {
    const full = new FakeHost(consumer(), [], consumerInputs)
      .available("producerEndpoint", "https://api.example")
      .available("producerPreview", "https://preview.example")
      .run();
    const fullCanonical = new Set(full.resources.map((resource) => `${resource.address}\0${resource.canonical}`));

    for (let mask = 0; mask < 4; mask += 1) {
      const host = new FakeHost(consumer(), [], consumerInputs);
      mask & 1 ? host.available("producerEndpoint", "https://api.example") : host.blocked("producerEndpoint");
      mask & 2 ? host.available("producerPreview", "https://preview.example") : host.blocked("producerPreview");
      const partial = host.run();
      for (const resource of partial.resources) {
        expect(fullCanonical.has(`${resource.address}\0${resource.canonical}`)).toBe(true);
      }
    }
  });
});

describe("canonical serialization", () => {
  it("sorts keys recursively and preserves array order", () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, b: [3, 1] } })).toBe(
      '{"a":{"b":[3,1],"y":2},"z":1}',
    );
  });
});
