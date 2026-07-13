import {
  declareOutputs,
  defineWorker,
  h,
  secret,
  workerOutputs,
  type OutputReference,
} from "../src/index.js";

const service = declareOutputs(
  "service-a",
  h.object({ api: h.url(), tokenRef: h.string() }),
);

const api: OutputReference<string, "url"> = service.api;
const token: OutputReference<string, "secret"> = secret(service.tokenRef);
void api;
void token;

defineWorker({
  outputs: workerOutputs,
  vars: { BACKEND_URL: service.api },
});

// @ts-expect-error URL outputs cannot be rebound as secrets.
secret(service.api);
