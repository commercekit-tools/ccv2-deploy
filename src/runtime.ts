import {
  defaultRuntime,
  type RuntimeDependencies,
} from "@commercekit-tools/ccv2-client";
export type Runtime = RuntimeDependencies;
export const runtime: Runtime = {
  ...defaultRuntime,
  now: () => performance.now(),
};
