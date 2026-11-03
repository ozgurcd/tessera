import { ANY_METHOD, UNRESOLVED_ROUTE, type AllowEntry, type CheckResult, type FieldLocation, type Finding, type ReadSet, type RulesConfig, type SendSet, type Site, type UnresolvedDetail } from "./types.js";

function key(method: string, route: string): string {
  return `${method.toUpperCase()} ${route}`;
}

function allowed(allow: AllowEntry[], method: string, route: string, location: FieldLocation, field: string): boolean {
  return allow.some((entry) => entry.method.toUpperCase() === method && entry.route === route && entry.location === location && entry.field === field);
}

function siteKey(site: Site): string {
  return `${site.file}:${site.line}`;
}

function uniqueSites(sites: Site[]): Site[] {
  const seen = new Set<string>();
  return sites.filter((site) => {
    const value = siteKey(site);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function readSites(read: ReadSet): Site[] {
  return uniqueSites(read.sites?.length ? read.sites : [read.site]);
}

function readUnresolved(read: ReadSet): UnresolvedDetail[] {
  return read.unresolvedDetails?.length
    ? read.unresolvedDetails
    : read.unresolved.map((message) => ({ message, site: read.site }));
}

function uniqueUnresolved(details: UnresolvedDetail[]): UnresolvedDetail[] {
  const seen = new Set<string>();
  return details.filter((detail) => {
    const value = `${siteKey(detail.site)}:${detail.message}`;
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

const UNMODELED_FIELDS_NOTE = "net/http handler fields are not analyzed";

function intersect(left: string[], right: string[]): string[] {
  const values = new Set(right);
  return left.filter((field) => values.has(field));
}

function readMapFor(reads: ReadSet[]): Map<string, ReadSet> {
  const result = new Map<string, ReadSet>();
  for (const read of reads) {
    const endpoint = key(read.method, read.route);
    const existing = result.get(endpoint);
    if (!existing) {
      result.set(endpoint, { ...read });
      continue;
    }
    const unresolvedDetails = uniqueUnresolved([
      ...readUnresolved(existing),
      ...readUnresolved(read),
      { message: "multiple server read sets represent this endpoint", site: existing.site },
    ]);
    result.set(endpoint, {
      ...existing,
      query: intersect(existing.query, read.query),
      body: intersect(existing.body, read.body),
      unresolved: unresolvedDetails.map((detail) => detail.message),
      unresolvedDetails,
      sites: uniqueSites([...readSites(existing), ...readSites(read)]),
      ...(existing.fieldsUnmodeled || read.fieldsUnmodeled ? { fieldsUnmodeled: true } : {}),
    });
  }
  return result;
}

function deduplicate(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const value = JSON.stringify(finding);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function match(sends: SendSet[], reads: ReadSet[], rules: RulesConfig, allow: AllowEntry[]): CheckResult {
  const findings: Finding[] = [];
  const readMap = readMapFor(reads);
  const sendMap = new Map<string, SendSet[]>();
  const sentRoutes = new Set(sends.map((send) => send.route));
  for (const send of sends) {
    const endpoint = key(send.method, send.route);
    const values = sendMap.get(endpoint) ?? [];
    values.push(send);
    sendMap.set(endpoint, values);
    for (const message of send.unresolved) findings.push({ kind: "unresolved", message, site: send.site });
    if (send.route === "<unresolved>") continue;
    // A method-less net/http pattern serves every method; a method-specific one takes precedence.
    const read = readMap.get(endpoint) ?? readMap.get(key(ANY_METHOD, send.route));
    if (!read) {
      findings.push({ kind: "unmapped", method: send.method, route: send.route, site: send.site, error: rules.unmapped === "error" });
      continue;
    }
    for (const location of ["query", "body"] as const) {
      if (read.fieldsUnmodeled) {
        if (send[location].length) findings.push({ kind: "unresolved", message: `${location} fields [${send[location].join(", ")}] sent to ${send.method} ${send.route} cannot be verified: ${UNMODELED_FIELDS_NOTE} (${readSites(read).map(siteKey).join(", ")})`, site: send.site });
        continue;
      }
      const readFields = new Set(read[location]);
      for (const field of send[location]) {
        if (!readFields.has(field) && !allowed(allow, send.method, send.route, location, field)) {
          const counterparts = readSites(read);
          findings.push({ kind: "unmatched", method: send.method, route: send.route, location, field, direction: "sent-not-read", source: send.site, counterpart: counterparts[0]!, ...(counterparts.length > 1 ? { counterparts } : {}) });
        }
      }
    }
  }
  for (const read of readMap.values()) {
    // An unresolved registration pairs with no client call, so it is reported unconditionally.
    const paired = read.route === UNRESOLVED_ROUTE || (read.method === ANY_METHOD ? sentRoutes.has(read.route) : sendMap.has(key(read.method, read.route)));
    if (paired) {
      for (const detail of readUnresolved(read)) findings.push({ kind: "unresolved", message: detail.message, site: detail.site });
    }
    if (!rules.reverseDirection || read.fieldsUnmodeled) continue;
    const endpointSends = sendMap.get(key(read.method, read.route));
    if (!endpointSends?.length) continue;
    const sources = readSites(read);
    const counterparts = uniqueSites(endpointSends.map((send) => send.site));
    for (const location of ["query", "body"] as const) {
      const sentFields = new Set(endpointSends.flatMap((send) => send[location]));
      for (const field of read[location]) {
        if (!sentFields.has(field) && !allowed(allow, read.method, read.route, location, field)) {
          findings.push({
            kind: "unmatched",
            method: read.method,
            route: read.route,
            location,
            field,
            direction: "read-not-sent",
            source: sources[0]!,
            counterpart: counterparts[0]!,
            ...(sources.length > 1 ? { sources } : {}),
            ...(counterparts.length > 1 ? { counterparts } : {}),
          });
        }
      }
    }
  }
  const unique = deduplicate(findings);
  const summary = {
    unmatched: unique.filter((finding) => finding.kind === "unmatched").length,
    unresolved: unique.filter((finding) => finding.kind === "unresolved").length,
    unmapped: unique.filter((finding) => finding.kind === "unmapped").length,
  };
  const hasErrorFinding = summary.unmatched > 0 || unique.some((finding) => finding.kind === "unmapped" && finding.error);
  const hasUnresolvedError = summary.unresolved > 0 && rules.unresolved === "error";
  return { schemaVersion: 1, sends, reads, findings: unique, summary, exitCode: hasErrorFinding ? 1 : hasUnresolvedError ? 3 : 0 };
}
