import type { AllowEntry, CheckResult, FieldLocation, Finding, ReadSet, RulesConfig, SendSet, Site, UnresolvedDetail } from "./types.js";

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
  for (const send of sends) {
    const endpoint = key(send.method, send.route);
    const values = sendMap.get(endpoint) ?? [];
    values.push(send);
    sendMap.set(endpoint, values);
    for (const message of send.unresolved) findings.push({ kind: "unresolved", message, site: send.site });
    if (send.route === "<unresolved>") continue;
    const read = readMap.get(endpoint);
    if (!read) {
      findings.push({ kind: "unmapped", method: send.method, route: send.route, site: send.site, error: rules.unmapped === "error" });
      continue;
    }
    for (const location of ["query", "body"] as const) {
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
    if (sendMap.has(key(read.method, read.route))) {
      for (const detail of readUnresolved(read)) findings.push({ kind: "unresolved", message: detail.message, site: detail.site });
    }
    if (!rules.reverseDirection) continue;
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
