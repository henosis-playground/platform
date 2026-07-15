import { artifact, defineComponent, input, output, value } from "@henosis/core";
import { worker } from "@henosis/platform-cloudflare";
import backend from "./backend.js";

export default defineComponent({
  name: "frontend",
  artifacts: [artifact.buildWorker("workerArtifact", "workers/frontend.ts")],
  inputs: {
    backendUrl: input.required(backend.outputs.url),
    backendWorkerName: input.required(backend.outputs.workerName),
    workerArtifact: input.config(value.artifactDigest()),
  },
  outputs: { url: output.observed(value.url()) },
  build(context, inputs) {
    const emitted = context.emit(worker.create("frontend", {
      source: { entry: artifact.worker(inputs.workerArtifact.value) },
      compatibilityDate: "2026-07-15",
      compatibilityFlags: ["global_fetch_strictly_public"],
      vars: { BACKEND_URL: inputs.backendUrl.value },
      services: { BACKEND: inputs.backendWorkerName.value },
    }));
    return { url: emitted.outputs.url };
  },
});
