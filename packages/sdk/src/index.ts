import { createComponent } from "./types.js";
import type { BindingShape, Component, ComponentSpec } from "./types.js";

export * as conventions from "./conventions.js";
export {
  httpUrl,
  namespaceFor,
  postgresUrl,
  publicUrl,
  serviceHost,
} from "./conventions.js";
export {
  executeBinding,
  executeBuild,
  materialiseBinding,
  materialiseToken,
} from "./executor.js";
export { isBindingValueLike, isComponentLike } from "./types.js";
export type {
  BindingBuilder,
  BindingShape,
  BindingValue,
  BuildContext,
  Component,
  DependencyResolver,
  Env,
  EnvId,
  ImageRef,
  PostgresRecord,
  ResourceRecord,
  Resolved,
  ServiceRecord,
  TokenResolver,
} from "./types.js";

export function defineComponent<B extends BindingShape>(
  name: string,
  spec: ComponentSpec<B>,
): Component<B> {
  return createComponent(name, spec);
}
