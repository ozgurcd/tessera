import type { CheckResult, Finding, ReadSet, SendSet, Site } from "./types.js";

function location(site: Site): string {
  return `${site.file}:${site.line}`;
}

function locations(sites: Site[]): string {
  return sites.map(location).join(", ");
}

function endpointSites(endpoint: SendSet | ReadSet): Site[] {
  return "sites" in endpoint && endpoint.sites?.length ? endpoint.sites : [endpoint.site];
}

export function findingLine(finding: Finding): string {
  if (finding.kind === "unmatched") {
    if (finding.direction === "sent-not-read") {
      const counterparts = finding.counterparts ?? [finding.counterpart];
      const mismatch = counterparts.length > 1 ? "is not read by every possible handler" : "no handler field reads it";
      return `UNMATCHED  ${finding.method} ${finding.route}  ${finding.location} field '${finding.field}' is sent by ${location(finding.source)} but ${mismatch} (${locations(counterparts)})`;
    }
    return `UNMATCHED  ${finding.method} ${finding.route}  ${finding.location} field '${finding.field}' is read by ${locations(finding.sources ?? [finding.source])} but no client call sends it (${locations(finding.counterparts ?? [finding.counterpart])})`;
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
  return `${kind} ${endpoint.method} ${endpoint.route} query=[${endpoint.query.join(", ")}] body=[${endpoint.body.join(", ")}] ${locations(endpointSites(endpoint))}${unresolved}`;
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
    ...matchingSends.map((item) => `SENT ${item.method}  query=[${item.query.join(", ")}] body=[${item.body.join(", ")}]  ${locations(endpointSites(item))}`),
    ...matchingReads.map((item) => `READ ${item.method}  query=[${item.query.join(", ")}] body=[${item.body.join(", ")}]  ${locations(endpointSites(item))}`),
  ].join("\n");
}
