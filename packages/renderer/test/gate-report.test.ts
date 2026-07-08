import { describe, expect, it } from "vitest";
import { parseCompileFailures } from "../src/gate-report.js";

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
        component: "service-b",
        consumerOf: "service-a",
        kind: "compile",
        message: "service-b consumes service-a.api which no longer exists",
        excerpt:
          "../../node_modules/@henosis/service-b/src/index.ts(10,33): error TS2339: Property 'api' does not exist on type '{ readonly newApiName: Ref<string>; }'.",
      },
    ]);
  });
});
