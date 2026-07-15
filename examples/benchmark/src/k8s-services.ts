import { defineComponent, input, output, value } from "@henosis/core";
import { emitObject, emitServicePair } from "@henosis/platform-k8s";
import backend from "./backend.js";

export default defineComponent({
  name: "service_pair",
  inputs: {
    backendUrl: input.required(backend.outputs.url),
    replicas: input.config(value.number(), { default: 1 }),
  },
  outputs: {
    apiUrl: output.static(value.url()),
    webUrl: output.static(value.url()),
  },
  build(context, inputs) {
    emitObject(context, "namespace", {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: "benchmark" },
    });
    const api = emitServicePair(context, "api", {
      namespace: "benchmark",
      image: "registry.example/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      targetPort: 3000,
      replicas: inputs.replicas.value,
      resources: { requests: { cpu: "100m", memory: "128Mi" } },
    });
    const web = emitServicePair(context, "web", {
      namespace: "benchmark",
      image: "registry.example/web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      targetPort: 8080,
      replicas: inputs.replicas.value,
      env: {
        API_URL: api.url,
        HENOSIS_BACKEND_URL: inputs.backendUrl.value,
      },
      resources: { requests: { cpu: "50m", memory: "64Mi" } },
    });
    return { apiUrl: api.url, webUrl: web.url };
  },
});
