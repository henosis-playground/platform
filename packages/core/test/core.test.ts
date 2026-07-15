import { describe, expect, it } from "vitest";
import {
  AuthoringError,
  Blocked,
  canonicalStringify,
  defineComponent,
  defineResource,
  input,
  output,
  value,
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

function consumer() {
  return defineComponent({
    name: "consumer",
    inputs: {
      endpoint: input.required(producer.outputs.endpoint),
      preview: input.optional(producer.outputs.preview),
    },
    outputs: {
      label: output.static(value.string()),
      endpoint: output.observed(value.url()),
    },
    build: (context, inputs) => {
      context.emit(testResource.create("prefix", { message: "stable" }));
      const endpoint = inputs.endpoint.value;
      const message = inputs.preview.present
        ? `${endpoint} -> ${inputs.preview.value}`
        : endpoint;
      const emitted = context.emit(testResource.create("final", { message }));
      return { label: "consumer", endpoint: emitted.outputs.endpoint };
    },
  });
}

describe("in-process host", () => {
  it("evaluates fully and returns canonical total resources", () => {
    const result = new FakeHost(consumer())
      .available("endpoint", "https://api.example")
      .absent("preview")
      .run();

    expect(result).toMatchObject({
      status: "complete",
      outputs: { label: "consumer" },
      observedOutputs: {
        endpoint: { resource: "test/message@1/final", output: "endpoint" },
      },
      reads: ["endpoint"],
    });
    expect(result.resources.map((resource) => resource.canonical)).toEqual([
      '{"message":"stable"}',
      '{"message":"https://api.example"}',
    ]);
  });

  it("keeps the deterministic emitted prefix when blocked, then reruns", () => {
    const host = new FakeHost(consumer()).blocked("endpoint").absent("preview");
    const blocked = host.run();
    expect(blocked).toMatchObject({
      status: "blocked",
      blocked: { input: "endpoint", source: "producer.endpoint" },
      reads: ["endpoint"],
    });
    expect(blocked.resources.map((resource) => resource.address)).toEqual([
      "test/message@1/prefix",
    ]);

    const complete = host.available("endpoint", "https://api.example").run();
    expect(complete.status).toBe("complete");
    expect(complete.resources.map((resource) => resource.address)).toEqual([
      "test/message@1/prefix",
      "test/message@1/final",
    ]);
  });

  it("remains blocked when component code catches and swallows Blocked", () => {
    const swallowing = defineComponent({
      name: "swallowing",
      inputs: { endpoint: input.required(producer.outputs.endpoint) },
      outputs: { fabricatedValue: output.static(value.string()) },
      build: (context, inputs) => {
        try {
          inputs.endpoint.value;
        } catch (error) {
          if (!(error instanceof Blocked)) throw error;
        }
        context.emit(testResource.create("fabricated", { message: "not actually complete" }));
        return { fabricatedValue: "fake" };
      },
    });

    expect(new FakeHost(swallowing).blocked("endpoint").run()).toMatchObject({
      status: "blocked",
      resources: [],
      blocked: { input: "endpoint", source: "producer.endpoint" },
      reads: ["endpoint"],
    });
  });

  it("branches on optional presence without reading or blocking", () => {
    const absent = new FakeHost(consumer())
      .available("endpoint", "https://api.example")
      .absent("preview")
      .run();
    expect(absent.reads).toEqual(["endpoint"]);

    const blocked = new FakeHost(consumer())
      .available("endpoint", "https://api.example")
      .blocked("preview")
      .run();
    expect(blocked).toMatchObject({
      status: "blocked",
      blocked: { input: "preview", operation: "reading `.value`" },
      reads: ["endpoint", "preview"],
    });
  });
});

describe("author diagnostics", () => {
  it("explains the separate target and TypeScript API naming rules", () => {
    expect(() => defineComponent({
      name: "BadComponent",
      outputs: {},
      build: () => ({}),
    })).toThrow("Resource logical names and component names flow into target identifiers");

    expect(() => defineComponent({
      name: "valid_component",
      outputs: { "worker-name": output.static(value.string()) },
      build: () => ({ "worker-name": "worker" }),
    })).toThrow("Input and output names are TypeScript API surface");
  });

  it("snapshots accidental handle insertion", () => {
    const broken = defineComponent({
      name: "broken",
      inputs: { endpoint: input.required(producer.outputs.endpoint) },
      outputs: { endpoint: output.observed(value.url()) },
      build: (context, inputs) => {
        const emitted = context.emit(testResource.create("bad", {
          message: inputs.endpoint as unknown as JsonValue,
        }));
        return { endpoint: emitted.outputs.endpoint };
      },
    });

    expect(new FakeHost(broken).blocked("endpoint").run()).toMatchInlineSnapshot(`
      {
        "blocked": {
          "code": "HENOSIS_BLOCKED",
          "input": "endpoint",
          "message": "blocked[HENOSIS_BLOCKED]: input "endpoint" from producer.endpoint is not available
        |
        = note: serializing resource test/message@1/bad.message requires its concrete value
        = help: Henosis recorded this read and will re-run the component when the producer publishes it",
          "operation": "serializing resource test/message@1/bad.message",
          "source": "producer.endpoint",
        },
        "protocolVersion": 1,
        "reads": [
          "endpoint",
        ],
        "resources": [],
        "status": "blocked",
      }
    `);

    expect(() => new FakeHost(broken).available("endpoint", "https://api.example").run())
      .toThrowErrorMatchingInlineSnapshot(`
        [AuthoringError: error[HENOSIS_INPUT_HANDLE_SERIALIZED]: Input handle "endpoint" was placed into resource test/message@1/bad.message.
          |
          = help: Use inputs.endpoint.value. Resources are total and cannot contain handles.]
      `);
  });

  it("marks blocked before blocked-handle serialization throws", () => {
    const swallowing = defineComponent({
      name: "serialization_swallowing",
      inputs: { endpoint: input.required(producer.outputs.endpoint) },
      outputs: { fabricatedValue: output.static(value.string()) },
      build: (context, inputs) => {
        try {
          context.emit(testResource.create("bad", {
            message: inputs.endpoint as unknown as JsonValue,
          }));
        } catch (error) {
          if (!(error instanceof Blocked)) throw error;
        }
        return { fabricatedValue: "fake" };
      },
    });

    expect(new FakeHost(swallowing).blocked("endpoint").run()).toMatchObject({
      status: "blocked",
      resources: [],
      blocked: {
        input: "endpoint",
        operation: "serializing resource test/message@1/bad.message",
      },
      reads: ["endpoint"],
    });
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
    const full = new FakeHost(consumer())
      .available("endpoint", "https://api.example")
      .available("preview", "https://preview.example")
      .run();
    const fullCanonical = new Set(full.resources.map((resource) => `${resource.address}\0${resource.canonical}`));

    for (let mask = 0; mask < 4; mask += 1) {
      const host = new FakeHost(consumer());
      mask & 1 ? host.available("endpoint", "https://api.example") : host.blocked("endpoint");
      mask & 2 ? host.available("preview", "https://preview.example") : host.blocked("preview");
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
