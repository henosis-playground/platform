import { describe, expect, it } from "vitest";
import {
  declareOutputs,
  defineWorker,
  h,
  parseEnvironment,
  secret,
  workerOutputs,
} from "../src/index.js";

describe("Cloudflare Worker authoring", () => {
  it("emits the deployed connector input contract", () => {
    const backend = declareOutputs(
      "service-a",
      h.object({ api: h.url(), tokenRef: h.string() }),
    );

    expect(
      defineWorker({
        outputs: workerOutputs,
        vars: {
          BACKEND_URL: backend.api,
          TOKEN: secret(backend.tokenRef),
        },
      }),
    ).toEqual({
      outputs: workerOutputs,
      inputs: {
        BACKEND_URL: {
          kind: "url",
          component: "service-a",
          output: "api",
        },
        TOKEN: {
          kind: "secret",
          component: "service-a",
          output: "tokenRef",
        },
      },
      environments: ["dev", "prod", "preview"],
    });
  });

  it("accepts only connector-supported environment names", () => {
    expect(parseEnvironment("dev")).toEqual({ kind: "dev" });
    expect(parseEnvironment("preview_3jhc7x633z88188fzqhcbbrf84")).toEqual({
      kind: "preview",
      id: "preview_3jhc7x633z88188fzqhcbbrf84",
    });
    expect(() => parseEnvironment("staging")).toThrow(
      "Unsupported Cloudflare environment",
    );
  });
});
