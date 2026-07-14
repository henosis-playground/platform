import {
  defineResource,
  output,
  value,
  type BuildContext,
  type EmittedResource,
} from "@henosis/core";

export interface SourceRef {
  /** Repository-relative entry module bundled with the component closure. */
  readonly entry: string;
  /** Optional repository-relative static assets directory. */
  readonly assets?: string;
}

export interface WorkerBody {
  readonly source: SourceRef;
  readonly compatibilityDate?: string;
  readonly vars?: Readonly<Record<string, string | number | boolean>>;
}

export const workerOutputs = {
  url: output.observed(value.url()),
  workerName: output.observed(value.string()),
  deploymentId: output.observed(value.string()),
  versionId: output.observed(value.string()),
} as const;

export const worker = defineResource<WorkerBody, typeof workerOutputs>({
  kind: "cloudflare/worker@1",
  outputs: workerOutputs,
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
