import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractClient } from "./client.js";
import { loadConfig } from "./config.js";
import { GoGinAdapter } from "./go-gin.js";
import { match } from "./matcher.js";
import { humanResult } from "./report.js";

export type SelftestResult = { schemaVersion: 1; passed: number; total: number; lines: string[] };

const CASES = [
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
] as const;

export async function runSelftest(): Promise<SelftestResult> {
  const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
  const lines: string[] = [];
  let passed = 0;
  for (const fixture of CASES) {
    try {
      const configPath = path.join(fixtureRoot, fixture.directory, "tessera.config.json");
      const loaded = loadConfig(configPath);
      const sends = extractClient(loaded.config.client, loaded.directory);
      const reads = await new GoGinAdapter().extract(loaded.config.server, loaded.directory);
      const result = match(sends, reads, loaded.config.rules, loaded.config.allow);
      const output = humanResult(result);
      const missing = fixture.includes.filter((text) => !output.includes(text));
      if (result.exitCode === fixture.exitCode && !missing.length) {
        passed += 1;
        lines.push(`PASS ${fixture.directory}`);
      } else {
        lines.push(`FAIL ${fixture.directory}: exit ${result.exitCode} (wanted ${fixture.exitCode})${missing.length ? `; missing ${missing.join(", ")}` : ""}`);
      }
    } catch (error) {
      lines.push(`FAIL ${fixture.directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  lines.push(`tessera selftest: ${passed}/${CASES.length} passed`);
  return { schemaVersion: 1, passed, total: CASES.length, lines };
}
