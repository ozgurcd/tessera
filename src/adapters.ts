import { GoGinAdapter } from "./go-gin.js";
import { GoNetHttpAdapter } from "./go-nethttp.js";
import type { ServerAdapter } from "./types.js";

const ADAPTERS: Record<string, () => ServerAdapter> = {
  "go-gin": () => new GoGinAdapter(),
  "go-nethttp": () => new GoNetHttpAdapter(),
};

export const ADAPTER_NAMES = Object.keys(ADAPTERS);

export function adapterFor(name: string): ServerAdapter {
  const create = ADAPTERS[name];
  if (!create) throw new Error(`unknown server adapter '${name}'`);
  return create();
}
