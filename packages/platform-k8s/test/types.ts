import { defineComponent, h } from "../src/index.js";

defineComponent({
  outputs: h.object({ api: h.url() }),
  build: (ctx) => {
    // @ts-expect-error resources are required and have no platform default.
    const service = ctx.namespace("payments").service("api", {
      targetPort: 8080,
    });
    return { api: service.url };
  },
});

defineComponent({
  outputs: h.object({ api: h.url() }),
  params: {
    dev: { replicas: 1 },
    prod: { replicas: 3 },
    preview: { replicas: 1 },
  },
  build: (ctx, params) => {
    const row: { replicas: number } = params;
    const service = ctx.namespace("payments").service("api", {
      targetPort: 8080,
      replicas: row.replicas,
      resources: { requests: { cpu: "100m", memory: "128Mi" } },
    });
    return { api: service.url };
  },
});
