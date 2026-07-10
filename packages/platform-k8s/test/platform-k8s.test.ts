import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateWorld, representativePreviewName } from "@henosis/core";
import { parseAllDocuments } from "yaml";
import { validate as validateDeployment } from "kubernetes-models/_schemas/IoK8sApiAppsV1Deployment";
import { validate as validateHpa } from "kubernetes-models/_schemas/IoK8sApiAutoscalingV2HorizontalPodAutoscaler";
import { validate as validateNamespace } from "kubernetes-models/_schemas/IoK8sApiCoreV1Namespace";
import { validate as validateService } from "kubernetes-models/_schemas/IoK8sApiCoreV1Service";
import { validate as validatePdb } from "kubernetes-models/_schemas/IoK8sApiPolicyV1PodDisruptionBudget";
import { describe, expect, it } from "vitest";
import {
  defineComponent,
  deriveNamespaceName,
  deriveServiceName,
  deriveServiceUrl,
  h,
  kubernetesSchemaVersion,
  type Replicas,
} from "../src/index.js";

const digest = `sha256:${"a".repeat(64)}`;

function render(replicas: Replicas, servicePort = 80, scheme: "http" | "https" = "http") {
  const component = defineComponent({
    outputs: h.object({ url: h.url() }),
    params: {
      dev: { replicas },
      prod: { replicas },
      preview: { replicas },
    },
    build: (ctx, params) => {
      const service = ctx.namespace("Payments_API").service("Public_API", {
        targetPort: 8080,
        servicePort,
        scheme,
        replicas: params.replicas,
        resources: {
          requests: { cpu: "100m", memory: "128Mi" },
          limits: { cpu: "500m", memory: "512Mi" },
        },
        env: { ZED: 2, ALPHA: "one" },
      });
      return { url: service.url };
    },
  });
  return evaluateWorld({
    requestedEnv: { kind: "dev" },
    components: [
      {
        name: "sample",
        component,
        origin: {
          componentPackage: "@henosis/sample",
          componentPath: "/sample/src/index.ts",
          platformPath: "/platform-k8s",
        },
        image: { ref: "git-ref", digest },
      },
    ],
    dependencies: { sample: [] },
    changed: ["sample"],
  }).components.sample;
}

describe("Kubernetes records and stable YAML", () => {
  it("matches the fixed golden, always emits a PDB, and validates all four kinds", async () => {
    const result = render(2);
    const yaml = result?.artifacts[0]?.contents;
    expect(yaml).toBe(await golden("fixed.yaml"));
    expect(yaml).toContain("kind: PodDisruptionBudget");
    expect(yaml).not.toContain("kind: HorizontalPodAutoscaler");
    validateDocuments(yaml ?? "", [
      "Deployment",
      "PodDisruptionBudget",
      "Namespace",
      "Service",
    ]);
  });

  it("matches the ranged golden and validates all five object kinds", async () => {
    const result = render(
      { min: 3, max: 10, targetCpu: 70, disruption: { minAvailable: 2 } },
      8443,
      "https",
    );
    const yaml = result?.artifacts[0]?.contents;
    expect(yaml).toBe(await golden("ranged.yaml"));
    validateDocuments(yaml ?? "", [
      "Deployment",
      "HorizontalPodAutoscaler",
      "PodDisruptionBudget",
      "Namespace",
      "Service",
    ]);
  });

  it("resolves a cross-component Ref before projecting concrete YAML", () => {
    const producer = defineComponent({
      outputs: h.object({ port: h.number() }),
      build: (ctx) => {
        ctx.namespace("producer").service("api", {
          targetPort: 9000,
          resources: { requests: { cpu: "50m" } },
        });
        return { port: 9000 };
      },
    });
    const consumer = defineComponent({
      outputs: h.object({ api: h.url() }),
      build: (ctx) => {
        const service = ctx.namespace("consumer").service("api", {
          targetPort: producer.port,
          resources: { requests: { cpu: "50m" } },
          env: { UPSTREAM_PORT: producer.port },
        });
        return { api: service.url };
      },
    });
    const components = [
      ["producer", producer],
      ["consumer", consumer],
    ] as const;
    const result = evaluateWorld({
      requestedEnv: { kind: "dev" },
      components: components.map(([name, component]) => ({
        name,
        component,
        origin: {
          componentPackage: `@henosis/${name}`,
          componentPath: `/${name}/src/index.ts`,
          platformPath: "/platform-k8s",
        },
        image: { ref: `${name}-ref`, digest },
      })),
      dependencies: { producer: [], consumer: ["producer"] },
      changed: ["producer", "consumer"],
    });
    const yaml = result.components.consumer?.artifacts[0]?.contents ?? "";
    expect(yaml).toContain("containerPort: 9000");
    expect(yaml).toContain('value: "9000"');
    expect(yaml).not.toContain("henosis.ref");
  });
});

describe("Kubernetes derivations and build-time checks", () => {
  it("maps underscores, bounds names with a stable hash, and renders conventional URLs", () => {
    expect(
      deriveNamespaceName("Payments_API", {
        kind: "preview",
        id: representativePreviewName,
      }),
    ).toContain("payments-api-preview-");
    const long = deriveServiceName("A".repeat(90));
    expect(long).toHaveLength(63);
    expect(long).toMatch(/^a+-[0-9a-f]{8}$/);
    expect(deriveServiceUrl("http", "api.ns.svc.cluster.local", 80)).toBe(
      "http://api.ns.svc.cluster.local",
    );
    expect(deriveServiceUrl("https", "api.ns.svc.cluster.local", 8443)).toBe(
      "https://api.ns.svc.cluster.local:8443",
    );
  });

  it("throws on duplicate derived names and invalid HPA ranges during build", () => {
    const duplicate = defineComponent({
      outputs: h.object({ ok: h.string() }),
      build: (ctx) => {
        ctx.namespace("same");
        ctx.namespace("same");
        return { ok: "ok" };
      },
    });
    expect(() => evaluateWorld(singlePlan(duplicate))).toThrow("Duplicate namespace");

    const invalidRange = defineComponent({
      outputs: h.object({ ok: h.string() }),
      build: (ctx) => {
        ctx.namespace("range").service("api", {
          targetPort: 8080,
          replicas: { min: 5, max: 2, targetCpu: 70 },
          resources: { requests: { cpu: "100m" } },
        });
        return { ok: "ok" };
      },
    });
    expect(() => evaluateWorld(singlePlan(invalidRange))).toThrow(
      "replicas.min must not exceed replicas.max",
    );
  });

  it("pins Kubernetes schema validation to the declared target", () => {
    expect(kubernetesSchemaVersion).toBe("1.27.1");
  });
});

function singlePlan(component: ReturnType<typeof defineComponent>) {
  return {
    requestedEnv: { kind: "dev" as const },
    components: [
      {
        name: "sample",
        component,
        origin: {
          componentPackage: "@henosis/sample",
          componentPath: "/sample/src/index.ts",
          platformPath: "/platform-k8s",
        },
        image: { ref: "sample-ref", digest },
      },
    ],
    dependencies: { sample: [] },
    changed: ["sample"],
  };
}

async function golden(name: string): Promise<string> {
  return readFile(
    path.join(fileURLToPath(new URL(".", import.meta.url)), "golden", name),
    "utf8",
  );
}

function validateDocuments(yaml: string, expectedKinds: readonly string[]): void {
  const documents = parseAllDocuments(yaml).map((document) => document.toJSON());
  expect(documents.map((document) => document.kind)).toEqual(expectedKinds);
  const validators: Record<string, (value: unknown) => boolean> = {
    Deployment: validateDeployment,
    HorizontalPodAutoscaler: validateHpa,
    Namespace: validateNamespace,
    PodDisruptionBudget: validatePdb,
    Service: validateService,
  };
  for (const document of documents) {
    expect(validators[document.kind]?.(document)).toBe(true);
  }
}
