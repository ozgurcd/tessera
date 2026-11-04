import { GoGinAdapter } from "./go-gin.js";
import { GoNetHttpAdapter } from "./go-nethttp.js";
import { UNRESOLVED_ROUTE, type ReadSet, type ServerAdapter, type ServerConfig } from "./types.js";

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

function withPrefix(read: ReadSet, prefix: string | undefined): ReadSet {
  if (!prefix || read.route === UNRESOLVED_ROUTE) return read;
  return { ...read, route: read.route === "/" ? prefix : `${prefix}${read.route}` };
}

/**
 * Extracts the primary and every extra server root and concatenates their
 * endpoints. Each root's `prefix` is prepended to its routes; sites stay
 * relative to their own root. Unresolved registrations from all roots are
 * folded into the single entry the matcher reports unconditionally.
 */
export async function extractServers(primary: ServerConfig, extra: ServerConfig[], configDirectory: string): Promise<ReadSet[]> {
  const reads: ReadSet[] = [];
  let unresolved: ReadSet | undefined;
  for (const server of [primary, ...extra]) {
    for (const read of await adapterFor(server.adapter).extract(server, configDirectory)) {
      if (read.route !== UNRESOLVED_ROUTE) { reads.push(withPrefix(read, server.prefix)); continue; }
      unresolved = unresolved
        ? { ...unresolved, unresolved: [...unresolved.unresolved, ...read.unresolved], unresolvedDetails: [...(unresolved.unresolvedDetails ?? []), ...(read.unresolvedDetails ?? [])], sites: [...(unresolved.sites ?? [unresolved.site]), ...(read.sites ?? [read.site])] }
        : read;
    }
  }
  if (unresolved) reads.push(unresolved);
  return reads.sort((a, b) => a.method.localeCompare(b.method) || a.route.localeCompare(b.route));
}
