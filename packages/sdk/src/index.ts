import { createComponent } from "./types.js";
import type { BindingShape, Component, ComponentSpec } from "./types.js";

export * as conventions from "./conventions.js";
export {
  httpUrl,
  namespaceFor,
  publicUrl,
  serviceHost,
} from "./conventions.js";
export {
  executeBinding,
  executeBuild,
  materialiseToken,
} from "./executor.js";
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
  ServiceRecord,
  TokenResolver,
} from "./types.js";

export function defineComponent<B extends BindingShape>(
  name: string,
  spec: ComponentSpec<B>,
): Component<B> {
  return createComponent(name, spec);
}
