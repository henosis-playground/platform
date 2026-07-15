import { describe, expect, it } from "vitest";
import { FakeHost } from "@henosis/core/testing";
import backend from "../src/backend.js";
import database from "../src/database.js";
import frontend from "../src/frontend.js";
import servicePair from "../src/k8s-services.js";

describe("benchmark components", () => {
  it("initializes and evaluates database and backend through FakeHost", () => {
    const databaseResult = new FakeHost(database, [{
      path: "supabase/migrations/202607150001_catalog.sql",
      sha256: "sha256:1a86b4e289e8463f4f112d257e80d833f9dcba51cdfe7cfeb425c8e2acc164dd",
    }]).run();
    expect(databaseResult).toMatchObject({
      status: "complete",
      resources: [{
        body: {
          migrations: [{ sha256: "sha256:1a86b4e289e8463f4f112d257e80d833f9dcba51cdfe7cfeb425c8e2acc164dd" }],
        },
      }],
      observedOutputs: {
        restUrl: { resource: "supabase/schema@1/catalog", output: "restUrl" },
        anonKeyRef: { resource: "supabase/schema@1/catalog", output: "anonKeyRef" },
      },
    });

    const backendResult = new FakeHost(backend)
      .available("databaseUrl", "https://example.test/rest/v1")
      .available("workerArtifact", `sha256:${"ab".repeat(32)}`)
      .run();
    expect(backendResult).toMatchObject({
      status: "complete",
      observedOutputs: {
        url: { resource: "cloudflare/worker@1/backend", output: "url" },
        workerName: { resource: "cloudflare/worker@1/backend", output: "workerName" },
      },
      reads: ["databaseUrl", "workerArtifact"],
    });

    const backendUrl = "https://henosis-backend.workers.dev";
    const backendWorkerName = "henosis-backend-a65rfqgx";
    const frontendResult = new FakeHost(frontend)
      .available("backendUrl", backendUrl)
      .available("backendWorkerName", backendWorkerName)
      .available("workerArtifact", `sha256:${"cd".repeat(32)}`)
      .run();
    expect(frontendResult.resources[0]?.canonical).toContain(backendUrl);
    expect(frontendResult.resources[0]?.canonical).toContain(backendWorkerName);

    const servicePairResult = new FakeHost(servicePair)
      .available("backendUrl", backendUrl)
      .available("replicas", 3)
      .run();
    const deployments = servicePairResult.resources.filter((resource) => resource.address.endsWith("-deployment"));
    expect(deployments).toHaveLength(2);
    expect(deployments.every((resource) => resource.canonical.includes('"replicas":3'))).toBe(true);
    expect(deployments.some((resource) => resource.canonical.includes(backendUrl))).toBe(true);
  });
});
