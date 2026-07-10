import { defineComponent, h, type Params } from "../src/index.js";

type SampleParams = { host: string; replicas: number };

const params: Params<SampleParams> = {
  dev: { host: "dev.example", replicas: 1 },
  staging: { host: "staging.example", replicas: 2 },
  prod: { host: "prod.example", replicas: 3 },
  preview: { host: "preview.example", replicas: 1 },
};

defineComponent({
  outputs: h.object({ endpoint: h.url() }),
  params,
  build: (_ctx, params) => {
    // HOVER_FIXTURE: params
    return { endpoint: `https://${params.host}` };
  },
});
