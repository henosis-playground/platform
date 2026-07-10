import { defineComponent, h } from "../src/index.js";

defineComponent({
  outputs: h.object({ endpoint: h.url() }),
  params: {
    dev: { host: "dev.example", replicas: 1 },
    staging: { host: "staging.example", replicas: 2 },
    prod: { host: "prod.example", replicas: 3 },
    preview: { host: "preview.example", replicas: 1 },
  },
  build: (_ctx, params) => {
    // HOVER_FIXTURE: params
    return { endpoint: `https://${params.host}` };
  },
});
