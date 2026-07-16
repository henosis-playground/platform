import {
  defineResource,
  output,
  value,
  type ArtifactKind,
  type BuildContext,
  type EmittedResource,
  type ResourceDefinition,
  type ResourceIntent,
} from "@henosis/core";

const artifactSourceSymbol = Symbol.for("henosis.artifact-source.v1");

interface ArtifactSourceMarker {
  readonly [artifactSourceSymbol]: {
    readonly kind: ArtifactKind;
    readonly path: string;
  };
}

export interface SourceRef {
  /** Repository-relative Worker entry module. Henosis builds and binds its digest. */
  readonly entry: string;
  /** Optional repository-relative static-assets directory. */
  readonly assets?: string;
}

export interface WorkerBody {
  readonly source: SourceRef;
  readonly compatibilityDate?: string;
  readonly compatibilityFlags?: readonly string[];
  readonly vars?: Readonly<Record<string, string | number | boolean>>;
  /** Named Cloudflare service bindings keyed by the binding visible to the Worker. */
  readonly services?: Readonly<Record<string, string>>;
}

interface WorkerWireBody extends Omit<WorkerBody, "source"> {
  readonly source: {
    readonly entry: ArtifactSourceMarker;
    readonly assets?: ArtifactSourceMarker;
  };
}

export const workerOutputs = {
  url: output.observed(value.url()),
  workerName: output.observed(value.string()),
  deploymentId: output.observed(value.string()),
  versionId: output.observed(value.string()),
} as const;

const workerResource = defineResource<WorkerWireBody, typeof workerOutputs>({
  kind: "cloudflare/worker@1",
  outputs: workerOutputs,
});

export const worker: ResourceDefinition<WorkerBody, typeof workerOutputs> = Object.freeze({
  kind: workerResource.kind,
  outputs: workerResource.outputs,
  configFiles: workerResource.configFiles,
  create(name: string, body: WorkerBody): ResourceIntent<typeof workerOutputs> {
    return workerResource.create(name, {
      ...body,
      source: {
        entry: artifactSource("cloudflare-worker", body.source.entry),
        ...(body.source.assets === undefined
          ? {}
          : { assets: artifactSource("static-assets", body.source.assets) }),
      },
    });
  },
});

export interface TunnelBody {
  readonly origin: {
    readonly host: string;
    readonly port: number;
  };
}

export const tunnelOutputs = {
  tunnelId: output.observed(value.string()),
  tunnelName: output.observed(value.string()),
  privateHostname: output.observed(value.string()),
  tokenRef: output.observed(value.string()),
} as const;

export const tunnel = defineResource<TunnelBody, typeof tunnelOutputs>({
  kind: "cloudflare/tunnel@1",
  outputs: tunnelOutputs,
});

export interface RouteBody {
  readonly pattern: string;
  readonly zone: string;
  readonly workerName: string;
}

export const routeOutputs = {
  hostname: output.observed(value.string()),
} as const;

export const route = defineResource<RouteBody, typeof routeOutputs>({
  kind: "cloudflare/route@1",
  outputs: routeOutputs,
});

/** Emit a Worker while retaining its precise output-handle type. */
export function emitWorker(
  context: BuildContext,
  name: string,
  body: WorkerBody,
): EmittedResource<typeof workerOutputs> {
  return context.emit(worker.create(name, body));
}

function artifactSource(kind: ArtifactKind, path: string): ArtifactSourceMarker {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("Worker source paths must be normalized repository-relative paths");
  }
  return Object.freeze({
    [artifactSourceSymbol]: Object.freeze({ kind, path }),
  });
}
