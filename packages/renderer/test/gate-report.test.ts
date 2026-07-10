import { describe, expect, it } from "vitest";
import {
  parseCompileFailures,
  pipelineFailures,
} from "../src/gate-report.js";

describe("parseCompileFailures", () => {
  it("names the consumer, producer, and missing output ref", () => {
    const output = [
      "../../node_modules/@henosis/service-b/src/index.ts(10,33): error TS2339: Property 'api' does not exist on type '{ readonly newApiName: Ref<string>; }'.",
      "",
    ].join("\n");

    expect(
      parseCompileFailures(output, {
        "service-a": [],
        "service-b": ["service-a"],
      }),
    ).toEqual([
      {
        consumer: "service-b",
        producer: "service-a",
        pinnedSha: null,
        resolvedSha: null,
        outputsSchemaAtPinned: null,
        outputsSchemaAtResolved: null,
        consumedPaths: ["api"],
        kind: "compile",
        message: "service-b consumes service-a.api which no longer exists",
        excerpt:
          "../../node_modules/@henosis/service-b/src/index.ts(10,33): error TS2339: Property 'api' does not exist on type '{ readonly newApiName: Ref<string>; }'.",
      },
    ]);
  });

  it("keeps self-contract messages parser-compatible and moves context to the excerpt", () => {
    const [failure] = pipelineFailures(
      {
        stage: "resolved-output-validation",
        component: "service-a",
        message: "service-a.port expected number, got string",
      },
      { kind: "prod" },
    );

    expect(failure?.message).toBe(
      "service-a.port expected number, got string",
    );
    expect(failure?.excerpt).toBe(
      [
        "Environment: prod",
        "Pipeline stage: resolved-output-validation",
        "service-a.port expected number, got string",
      ].join("\n"),
    );
  });
});
