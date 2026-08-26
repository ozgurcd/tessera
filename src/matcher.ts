import type { AllowEntry, CheckResult, Finding, ReadSet, RulesConfig, SendSet } from "./types.js";

function key(method: string, route: string): string {
  return `${method.toUpperCase()} ${route}`;
}

function allowed(allow: AllowEntry[], method: string, route: string, field: string): boolean {
  return allow.some((entry) => entry.method.toUpperCase() === method && entry.route === route && entry.field === field);
}

export function match(sends: SendSet[], reads: ReadSet[], rules: RulesConfig, allow: AllowEntry[]): CheckResult {
  const findings: Finding[] = [];
  const readMap = new Map(reads.map((read) => [key(read.method, read.route), read]));
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
        if (!readFields.has(field) && !allowed(allow, send.method, send.route, field)) {
          findings.push({ kind: "unmatched", method: send.method, route: send.route, location, field, direction: "sent-not-read", source: send.site, counterpart: read.site });
        }
      }
    }
  }
  for (const read of reads) {
    if (sendMap.has(key(read.method, read.route))) {
      for (const message of read.unresolved) findings.push({ kind: "unresolved", message, site: read.site });
    }
    if (!rules.reverseDirection) continue;
    const endpointSends = sendMap.get(key(read.method, read.route));
    if (!endpointSends?.length) continue;
    const source = endpointSends[0]!;
    for (const location of ["query", "body"] as const) {
      const sentFields = new Set(endpointSends.flatMap((send) => send[location]));
      for (const field of read[location]) {
        if (!sentFields.has(field) && !allowed(allow, read.method, read.route, field)) {
          findings.push({ kind: "unmatched", method: read.method, route: read.route, location, field, direction: "read-not-sent", source: read.site, counterpart: source.site });
        }
      }
    }
  }
  const unique = findings.filter((finding, index) => findings.findIndex((other) => JSON.stringify(other) === JSON.stringify(finding)) === index);
  const summary = {
    unmatched: unique.filter((finding) => finding.kind === "unmatched").length,
    unresolved: unique.filter((finding) => finding.kind === "unresolved").length,
    unmapped: unique.filter((finding) => finding.kind === "unmapped").length,
  };
  const hasErrorFinding = summary.unmatched > 0 || unique.some((finding) => finding.kind === "unmapped" && finding.error);
  const hasUnresolvedError = summary.unresolved > 0 && rules.unresolved === "error";
  return { schemaVersion: 1, sends, reads, findings: unique, summary, exitCode: hasErrorFinding ? 1 : hasUnresolvedError ? 3 : 0 };
}
