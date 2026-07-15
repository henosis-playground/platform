import { describe, expect, it } from "vitest";
import { FakeHost } from "@henosis/core/testing";
import backend from "../src/backend.js";
import database from "../src/database.js";
import tunnel from "../src/tunnel.js";
import servicePair from "../src/k8s-services.js";

describe("benchmark components", () => {
  it("initializes and evaluates database, tunnel, and backend through FakeHost", () => {
    const databaseResult = new FakeHost(database).run();
    expect(databaseResult).toMatchObject({
      status: "complete",
      observedOutputs: {
        restUrl: { resource: "supabase/schema@1/catalog", output: "restUrl" },
        anonKeyRef: { resource: "supabase/schema@1/catalog", output: "anonKeyRef" },
      },
    });

    const tunnelResult = new FakeHost(tunnel).run();
    expect(tunnelResult).toMatchObject({
      status: "complete",
      observedOutputs: {
        hostname: { resource: "cloudflare/tunnel@1/supabase", output: "privateHostname" },
      },
    });

    const backendResult = new FakeHost(backend)
      .available("databaseUrl", "https://example.test/rest/v1")
      .available("tunnelHost", "supabase.internal")
      .run();
    expect(backendResult).toMatchObject({
      status: "complete",
      outputs: { workerName: "backend" },
      observedOutputs: {
        url: { resource: "cloudflare/worker@1/backend", output: "url" },
      },
      reads: ["databaseUrl", "tunnelHost"],
    });

    const servicePairResult = new FakeHost(servicePair).available("replicas", 3).run();
    const deployments = servicePairResult.resources.filter((resource) => resource.address.endsWith("-deployment"));
    expect(deployments).toHaveLength(2);
    expect(deployments.every((resource) => resource.canonical.includes('"replicas":3'))).toBe(true);
  });
});
