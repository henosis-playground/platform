import { defineComponent, input, output, value } from "@henosis/core";
import { worker } from "@henosis/platform-cloudflare";
import backend from "./backend.js";

export default defineComponent({
  name: "frontend",
  inputs: { backendUrl: input.required(backend.outputs.url) },
  outputs: { url: output.observed(value.url()) },
  build(context, inputs) {
    const emitted = context.emit(worker.create("frontend", {
      source: { entry: "workers/frontend.ts", assets: "web/dist" },
      compatibilityDate: "2026-07-15",
      vars: { BACKEND_URL: inputs.backendUrl.value },
    }));
    return { url: emitted.outputs.url };
  },
});
