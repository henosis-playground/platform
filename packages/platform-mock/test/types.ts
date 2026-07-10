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

// @ts-expect-error params are exhaustive and must include staging.
defineComponent({
  outputs: h.object({ endpoint: h.url() }),
  params: {
    dev: { host: "dev.example" },
    prod: { host: "prod.example" },
    preview: { host: "preview.example" },
  },
  build: (_ctx, params: { host: string }) => ({
    endpoint: `https://${params.host}`,
  }),
});

const extraRows = {
  dev: { host: "dev.example" },
  staging: { host: "staging.example" },
  prod: { host: "prod.example" },
  preview: { host: "preview.example" },
  qa: { host: "qa.example" },
};

defineComponent({
  outputs: h.object({ endpoint: h.url() }),
  // @ts-expect-error params reject extra rows, including rows from variables.
  params: extraRows,
  build: () => ({ endpoint: "https://dev.example" }),
});

// @ts-expect-error a typo is both a missing prod row and an extra prdo row.
defineComponent({
  outputs: h.object({ endpoint: h.url() }),
  params: {
    dev: { host: "dev.example" },
    staging: { host: "staging.example" },
    prdo: { host: "prod.example" },
    preview: { host: "preview.example" },
  },
  build: () => ({ endpoint: "https://dev.example" }),
});
