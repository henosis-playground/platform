export function namespaceFor(envId: string): string {
  return `henosis-${envId}`;
}

export function serviceHost(component: string, envId: string): string {
  return `${component}.${namespaceFor(envId)}.svc.cluster.local`;
}

export function httpUrl(component: string, envId: string): string {
  return `http://${serviceHost(component, envId)}:80`;
}

export function publicUrl(component: string, envId: string): string {
  return `https://${component}-${envId}.henosis.example`;
}
