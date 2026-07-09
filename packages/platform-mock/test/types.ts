import {
  defineComponent,
  h,
  type BuildContext,
  type Env,
} from "../src/index.js";

defineComponent({
  outputs: h.object({ endpoint: h.url() }),
  params: {
    dev: { host: "dev.example", replicas: 1 },
    staging: { host: "staging.example", replicas: 2 },
    prod: { host: "prod.example", replicas: 3 },
    preview: { host: "preview.example", replicas: 1 },
  },
  build: (ctx, params) => {
    const typedContext: BuildContext = ctx;
    const typedEnvironment: Env = ctx.env;
    const inferredParams: { host: string; replicas: number } = params;
    void typedContext;
    void typedEnvironment;
    return { endpoint: `https://${inferredParams.host}` };
  },
});

defineComponent({
  outputs: h.object({ endpoint: h.url() }),
  // @ts-expect-error params are exhaustive and must include staging.
  params: {
    dev: { host: "dev.example" },
    prod: { host: "prod.example" },
    preview: { host: "preview.example" },
  },
  build: (_ctx, params: { host: string }) => ({
    endpoint: `https://${params.host}`,
  }),
});
