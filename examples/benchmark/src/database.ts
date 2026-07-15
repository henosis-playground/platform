import { config, defineComponent, output, value } from "@henosis/core";
import { migration, schema } from "@henosis/platform-supabase";

export default defineComponent({
  name: "database",
  files: [config.file("supabase/migrations/202607150001_catalog.sql")],
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
