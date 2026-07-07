export function namespaceFor(envId) {
    return `henosis-${envId}`;
}
export function serviceHost(component, envId) {
    return `${component}.${namespaceFor(envId)}.svc.cluster.local`;
}
export function httpUrl(component, envId) {
    return `http://${serviceHost(component, envId)}:80`;
}
export function publicUrl(component, envId) {
    return `https://${component}-${envId}.henosis.example`;
}
export function postgresUrl(component, dbName, envId) {
    return `postgres://henosis:henosis@${component}-${dbName}-postgres.${namespaceFor(envId)}.svc.cluster.local:5432/${dbName}`;
}
//# sourceMappingURL=conventions.js.map