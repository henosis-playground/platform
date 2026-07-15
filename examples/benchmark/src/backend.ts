import { defineComponent, input, native, output, value } from "@henosis/core";
import { worker } from "@henosis/platform-cloudflare";
import database from "./database.js";
import tunnel from "./tunnel.js";

export default defineComponent({
  name: "backend",
  files: [native.file("workers/backend.ts")],
  inputs: {
    databaseUrl: input.required(database.outputs.restUrl),
    tunnelHost: input.required(tunnel.outputs.hostname),
  },
  outputs: {
    url: output.observed(value.url()),
    workerName: output.static(value.string()),
  },
  build(context, inputs) {
    // HOVER_FIXTURE: inputs
    const workerName = "backend";
    const emitted = context.emit(worker.create(workerName, {
      source: { entry: "workers/backend.ts" },
      compatibilityDate: "2026-07-15",
      vars: {
        SUPABASE_REST_URL: inputs.databaseUrl.value,
        SUPABASE_TUNNEL_HOST: inputs.tunnelHost.value,
      },
    }));
    return { url: emitted.outputs.url, workerName };
  },
});
