import {
  databaseOutputs,
  declareOutputs,
  defineDatabase,
  h,
  type OutputReference,
  type SecretReference,
} from "../src/index.js";

const service = declareOutputs(
  "service-a",
  h.object({ api: h.url(), token: h.secretRef() }),
);

const api: OutputReference<string, "url"> = service.api;
const token: OutputReference<SecretReference, "secret"> = service.token;
void api;
void token;

defineDatabase({
  outputs: databaseOutputs,
  migrationsDir: "supabase/migrations",
  schema: "service_d",
  api: { expose: true, anonAccess: "read" },
  migrationInputs: {
    "202607130001_create_items": { upstream_url: service.api },
  },
});

// @ts-expect-error The connector implements only none and read.
defineDatabase({ outputs: databaseOutputs, migrationsDir: "m", schema: "service_d", api: { expose: true, anonAccess: "write" } });
