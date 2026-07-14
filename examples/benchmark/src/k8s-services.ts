import { defineComponent, output, value } from "@henosis/core";
import { emitObject, emitServicePair } from "@henosis/platform-k8s";

export default defineComponent({
  name: "service_pair",
  outputs: {
    apiUrl: output.static(value.url()),
    webUrl: output.static(value.url()),
  },
  build(context) {
    emitObject(context, "namespace", {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: "benchmark" },
    });
    const api = emitServicePair(context, "api", {
      namespace: "benchmark",
      image: "registry.example/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      targetPort: 3000,
      resources: { requests: { cpu: "100m", memory: "128Mi" } },
    });
    const web = emitServicePair(context, "web", {
      namespace: "benchmark",
      image: "registry.example/web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      targetPort: 8080,
      env: { API_URL: api.url },
      resources: { requests: { cpu: "50m", memory: "64Mi" } },
    });
    return { apiUrl: api.url, webUrl: web.url };
  },
});
