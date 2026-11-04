import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractClient } from "./client.js";
import { loadConfig } from "./config.js";
import { extractServers } from "./adapters.js";
import { match } from "./matcher.js";
import { humanResult } from "./report.js";

export type SelftestResult = { schemaVersion: 1; passed: number; total: number; lines: string[] };

type SelftestCase = { directory: string; exitCode: number; includes: readonly string[]; excludes?: readonly string[] };

const CASES: readonly SelftestCase[] = [
  { directory: "01-pagination", exitCode: 1, includes: ["field 'limit'", "field 'offset'"] },
  { directory: "02-helper", exitCode: 0, includes: ["0 unmatched, 0 unresolved"] },
  { directory: "03-literal-query", exitCode: 1, includes: ["GET /search", "field 'limit'"] },
  { directory: "04-interpolated-path", exitCode: 1, includes: ["/organizations/:param/members", "field 'member'"] },
  { directory: "05-conditional-body", exitCode: 1, includes: ["body field 'admin_email'"] },
  { directory: "06-typed-spread", exitCode: 1, includes: ["body field 'admin_email'"] },
  { directory: "07-computed-unresolved", exitCode: 3, includes: ["computed value", "computed field name"] },
  { directory: "08-unmapped", exitCode: 0, includes: ["UNMAPPED   GET /reports", "skipped, NOT checked"] },
  { directory: "09-endpoint-scope", exitCode: 1, includes: ["GET /first", "field 'limit'"] },
  { directory: "10-method-discrimination", exitCode: 1, includes: ["POST /resource", "query field 'page'"] },
  { directory: "11-duplicate-route-union", exitCode: 1, includes: ["1 unmatched, 2 unresolved", "body field 'ghost'", "duplicate route registration"], excludes: ["body field 'name'", "body field 'domain'", "body field 'admin_email'"] },
  { directory: "12-middleware-handler", exitCode: 1, includes: ["1 unmatched, 0 unresolved", "body field 'ghost'"], excludes: ["body field 'name'", "middleware_only"] },
  { directory: "13-bind-shapes", exitCode: 3, includes: ["0 unmatched, 2 unresolved", "bind shape 'c.ShouldBind' is not modeled", "bind shape 'c.ShouldBindUri' is not modeled"], excludes: ["query field 'page'", "query field 'sort'"] },
  { directory: "14-group-shadowing", exitCode: 1, includes: ["1 unmatched, 0 unresolved", "query field 'ghost'"], excludes: ["UNMAPPED", "router group variable", "third"] },
  { directory: "15-nested-struct-tags", exitCode: 1, includes: ["1 unmatched, 0 unresolved", "body field 'ghost'"], excludes: ["body field 'name'"] },
  { directory: "16-linear-group-scan", exitCode: 1, includes: ["POST /api/large", "1 unmatched, 0 unresolved", "body field 'ghost'"], excludes: ["body field 'known'"] },
  { directory: "17-context-helper", exitCode: 1, includes: ["1 unmatched, 0 unresolved", "query field 'ghost'"], excludes: ["query field 'active'", "query field 'deleted'"] },
  { directory: "18-unresolved-provenance", exitCode: 3, includes: ["UNRESOLVED actual.go:5  actual.go:5 bind shape 'c.ShouldBindUri' is not modeled", "0 unmatched, 2 unresolved"], excludes: ["UNRESOLVED fallback.go"] },
  { directory: "19-local-url-base", exitCode: 0, includes: ["0 unmatched, 0 unresolved, 0 unmapped"], excludes: ["UNMAPPED", "UNRESOLVED"] },
  { directory: "20-literal-union", exitCode: 1, includes: ["POST /api/v1/service-accounts/:param/disable", "POST /api/v1/service-accounts/:param/enable", "2 unmatched, 1 unresolved, 0 unmapped", "path segment has a non-finite union type"], excludes: ["UNMAPPED", "/api/v1/service-accounts/:param/:param"] },
  { directory: "21-nethttp", exitCode: 0, includes: ["0 unmatched, 1 unresolved, 2 unmapped", "UNMAPPED   POST /healthz", "UNMAPPED   GET /api/missing", "net/http handler fields are not analyzed"], excludes: ["UNMATCHED", "UNMAPPED   GET /api/v1/items", "UNMAPPED   DELETE", "UNMAPPED   GET /api/setup/status", "UNMAPPED   POST /api/setup/status", "UNMAPPED   GET /api/files", "UNMAPPED   GET /healthz"] },
  { directory: "22-const-object", exitCode: 1, includes: ["2 unmatched, 1 unresolved, 0 unmapped", "GET /api/v1/search  query field 'ghost'", "POST /api/v1/widgets  body field 'ghost_body'", "URL route is a computed value"], excludes: ["UNMAPPED", "field 'limit'", "field 'page'", "field 'name'"] },
  { directory: "23-route-prefix-strip", exitCode: 1, includes: ["1 unmatched, 0 unresolved, 1 unmapped", "GET /api/v1/items  query field 'ghost'", "UNMAPPED   GET /api/idpx/api/v1/items"], excludes: ["/api/idp/api", "field 'limit'"] },
  { directory: "24-wrapper-arg", exitCode: 1, includes: ["2 unmatched, 0 unresolved, 0 unmapped", "GET /api/v1/things  query field 'ghost'", "POST /api/v1/things  body field 'ghost_body'"], excludes: ["computed", "field 'limit'", "field 'name'"] },
  { directory: "25-nonreaders", exitCode: 1, includes: ["1 unmatched, 0 unresolved, 0 unmapped", "query field 'ghost'"], excludes: ["possible unconfigured query reader", "field 'limit'"] },
  { directory: "26-extra-servers", exitCode: 1, includes: ["1 unmatched, 0 unresolved, 1 unmapped", "GET /ag/api/v1/plan  query field 'ghost'", "UNMAPPED   GET /api/v1/plan"], excludes: ["UNMAPPED   GET /api/v1/things", "UNMAPPED   GET /ag/api/v1/plan", "field 'limit'"] },
  { directory: "27-const-mutation", exitCode: 0, includes: ["0 unmatched, 2 unresolved, 0 unmapped", "client.ts:9  URL route is a computed value", "client.ts:10  URL route is a computed value"], excludes: ["UNMAPPED", "client.ts:11"] },
  { directory: "28-subtree-stripprefix", exitCode: 0, includes: ["0 unmatched, 0 unresolved, 1 unmapped", "UNMAPPED   GET /api/v1/ghost"], excludes: ["UNMAPPED   GET /files", "UNMAPPED   GET /api/v1/items", "UNMAPPED   GET /api/v1/status"] },
];

export async function runSelftest(): Promise<SelftestResult> {
  const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
  const lines: string[] = [];
  let passed = 0;
  for (const fixture of CASES) {
    try {
      const configPath = path.join(fixtureRoot, fixture.directory, "tessera.config.json");
      const loaded = loadConfig(configPath);
      const sends = extractClient(loaded.config.client, loaded.directory);
      const reads = await extractServers(loaded.config.server, loaded.config.extraServers ?? [], loaded.directory);
      const result = match(sends, reads, loaded.config.rules, loaded.config.allow);
      const output = humanResult(result);
      const missing = fixture.includes.filter((text) => !output.includes(text));
      const unexpected = fixture.excludes?.filter((text) => output.includes(text)) ?? [];
      if (result.exitCode === fixture.exitCode && !missing.length && !unexpected.length) {
        passed += 1;
        lines.push(`PASS ${fixture.directory}`);
      } else {
        lines.push(`FAIL ${fixture.directory}: exit ${result.exitCode} (wanted ${fixture.exitCode})${missing.length ? `; missing ${missing.join(", ")}` : ""}${unexpected.length ? `; unexpectedly included ${unexpected.join(", ")}` : ""}`);
      }
    } catch (error) {
      lines.push(`FAIL ${fixture.directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  lines.push(`tessera selftest: ${passed}/${CASES.length} passed`);
  return { schemaVersion: 1, passed, total: CASES.length, lines };
}
