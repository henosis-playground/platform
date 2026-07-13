import { describe, expect, it } from "vitest";
import {
  databaseOutputs,
  declareOutputs,
  defineDatabase,
  h,
} from "../src/index.js";

describe("Supabase database authoring", () => {
  it("emits the deployed connector definition contract", () => {
    const upstream = declareOutputs(
      "service-a",
      h.object({ api: h.url(), token: h.secretRef() }),
    );

    expect(
      defineDatabase({
        outputs: databaseOutputs,
        migrationsDir: "./supabase/migrations",
        schema: "service_d",
        api: { expose: true, anonAccess: "read" },
        migrationInputs: {
          "202607130001_create_items": {
            upstream_url: upstream.api,
            upstream_token: upstream.token,
          },
        },
      }),
    ).toEqual({
      kind: "supabase.database",
      outputs: databaseOutputs,
      migrationsDir: "./supabase/migrations",
      schema: "service_d",
      api: { expose: true, anonAccess: "read" },
      migrationInputs: {
        "202607130001_create_items": {
          upstream_url: {
            kind: "url",
            component: "service-a",
            output: "api",
          },
          upstream_token: {
            kind: "secret",
            component: "service-a",
            output: "token",
          },
        },
      },
      environments: ["dev", "prod", "preview"],
    });
  });

  it("rejects invalid schema and migration paths before inspection", () => {
    expect(() =>
      defineDatabase({
        outputs: databaseOutputs,
        migrationsDir: "../migrations",
        schema: "service_d",
        api: { expose: true, anonAccess: "none" },
      }),
    ).toThrow("repository-relative");
    expect(() =>
      defineDatabase({
        outputs: databaseOutputs,
        migrationsDir: "supabase/migrations",
        schema: "Public",
        api: { expose: true, anonAccess: "none" },
      }),
    ).toThrow("schema must match");
  });
});
