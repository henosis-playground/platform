import { defineComponent, output, value } from "@henosis/core";
import { migration, schema } from "@henosis/platform-supabase";

export default defineComponent({
  name: "database",
  outputs: {
    restUrl: output.observed(value.url()),
    anonKeyRef: output.observed(value.string()),
  },
  build(context) {
    const database = context.emit(schema.create("catalog", {
      stack: "local",
      project: "henosis-local",
      database: "postgres",
      schema: "catalog",
      migrations: [
        migration(
          "202607150001_catalog",
          "supabase/migrations/202607150001_catalog.sql",
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        ),
      ],
      api: { expose: true, anonAccess: "read" },
    }));
    return {
      restUrl: database.outputs.restUrl,
      anonKeyRef: database.outputs.anonKeyRef,
    };
  },
});
