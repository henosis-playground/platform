import type { EnvId } from "./types.js";

export function namespaceFor(envId: EnvId): string {
  return `henosis-${envId}`;
}

export function serviceHost(component: string, envId: EnvId): string {
  return `${component}.${namespaceFor(envId)}.svc.cluster.local`;
}

export function httpUrl(component: string, envId: EnvId): string {
  return `http://${serviceHost(component, envId)}:80`;
}

export function publicUrl(component: string, envId: EnvId): string {
  return `https://${component}-${envId}.henosis.example`;
}

export function postgresUrl(
  component: string,
  dbName: string,
  envId: EnvId,
): string {
  return `postgres://henosis:henosis@${component}-${dbName}-postgres.${namespaceFor(envId)}.svc.cluster.local:5432/${dbName}`;
}
