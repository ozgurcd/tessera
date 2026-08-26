import type { CheckResult, Finding, ReadSet, SendSet, Site } from "./types.js";

function location(site: Site): string {
  return `${site.file}:${site.line}`;
}

export function findingLine(finding: Finding): string {
  if (finding.kind === "unmatched") {
    if (finding.direction === "sent-not-read") {
      return `UNMATCHED  ${finding.method} ${finding.route}  ${finding.location} field '${finding.field}' is sent by ${location(finding.source)} but no handler field reads it (${location(finding.counterpart)})`;
    }
    return `UNMATCHED  ${finding.method} ${finding.route}  ${finding.location} field '${finding.field}' is read by ${location(finding.source)} but no client sends it (${location(finding.counterpart)})`;
  }
  if (finding.kind === "unresolved") return `UNRESOLVED ${location(finding.site)}  ${finding.message}`;
  return `UNMAPPED   ${finding.method} ${finding.route}  (${finding.error ? "error, NOT checked" : "skipped, NOT checked"})`;
}

export function humanResult(result: CheckResult): string {
  const lines = result.findings.map(findingLine);
  lines.push(`tessera: ${result.summary.unmatched} unmatched, ${result.summary.unresolved} unresolved, ${result.summary.unmapped} unmapped`);
  return lines.join("\n");
}

function endpointLine(kind: "CLIENT" | "SERVER", endpoint: SendSet | ReadSet): string {
  const unresolved = endpoint.unresolved.length ? ` unresolved=[${endpoint.unresolved.join("; ")}]` : "";
  return `${kind} ${endpoint.method} ${endpoint.route} query=[${endpoint.query.join(", ")}] body=[${endpoint.body.join(", ")}] ${location(endpoint.site)}${unresolved}`;
}

export function humanList(sends: SendSet[], reads: ReadSet[]): string {
  return [...sends.map((item) => endpointLine("CLIENT", item)), ...reads.map((item) => endpointLine("SERVER", item))].join("\n");
}

export function humanExplain(route: string, sends: SendSet[], reads: ReadSet[]): string {
  const matchingSends = sends.filter((item) => item.route === route);
  const matchingReads = reads.filter((item) => item.route === route);
  if (!matchingSends.length && !matchingReads.length) return `tessera: no extracted endpoint matches ${route}`;
  return [
    `Route ${route}`,
    ...matchingSends.map((item) => `SENT ${item.method}  query=[${item.query.join(", ")}] body=[${item.body.join(", ")}]  ${location(item.site)}`),
    ...matchingReads.map((item) => `READ ${item.method}  query=[${item.query.join(", ")}] body=[${item.body.join(", ")}]  ${location(item.site)}`),
  ].join("\n");
}
