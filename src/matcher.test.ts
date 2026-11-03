import assert from "node:assert/strict";
import test from "node:test";
import { match } from "./matcher.js";
import { findingLine } from "./report.js";
import type { AllowEntry, ReadSet, SendSet } from "./types.js";

const site = { file: "example.ts", line: 1 };
const send: SendSet = { method: "POST", route: "/items", query: [], body: ["name", "trace_id"], unresolved: [], site };
const read: ReadSet = { method: "POST", route: "/items", query: [], body: ["name", "server_only"], unresolved: [], site: { file: "handler.go", line: 2 } };

test("allow entries suppress a matching sent-not-read field", () => {
  const result = match([send], [read], { unmapped: "skip", unresolved: "warn", reverseDirection: false }, [
    { method: "POST", route: "/items", location: "body", field: "trace_id", reason: "proxy consumes it" },
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.unmatched, 0);
});

test("reverse direction is opt-in", () => {
  const allowed: AllowEntry[] = [{ method: "POST", route: "/items", location: "body", field: "trace_id", reason: "proxy consumes it" }];
  const normal = match([send], [read], { unmapped: "skip", unresolved: "warn", reverseDirection: false }, allowed);
  const reverse = match([send], [read], { unmapped: "skip", unresolved: "warn", reverseDirection: true }, allowed);
  assert.equal(normal.summary.unmatched, 0);
  assert.equal(reverse.summary.unmatched, 1);
  assert.equal(reverse.exitCode, 1);
});

test("unmapped error and unresolved error have stable exit codes", () => {
  const unmapped = match([send], [], { unmapped: "error", unresolved: "warn", reverseDirection: false }, []);
  const unresolvedSend = { ...send, body: [], unresolved: ["computed"] };
  const unresolved = match([unresolvedSend], [read], { unmapped: "skip", unresolved: "error", reverseDirection: false }, []);
  assert.equal(unmapped.exitCode, 1);
  assert.equal(unresolved.exitCode, 3);
});

test("allow entries apply only to their configured request location", () => {
  const sharedName: SendSet = { ...send, query: ["trace_id"] };
  const result = match([sharedName], [read], { unmapped: "skip", unresolved: "warn", reverseDirection: false }, [
    { method: "POST", route: "/items", location: "body", field: "trace_id", reason: "proxy consumes body field" },
  ]);
  assert.equal(result.summary.unmatched, 1);
  assert.equal(result.findings.find((finding) => finding.kind === "unmatched")?.location, "query");
});

test("duplicate findings are collapsed and all endpoint sites are retained", () => {
  const duplicateSend = { ...send };
  const secondRead: ReadSet = { ...read, site: { file: "other-handler.go", line: 9 } };
  const result = match([send, duplicateSend], [read, secondRead], { unmapped: "skip", unresolved: "warn", reverseDirection: false }, []);
  assert.equal(result.summary.unmatched, 1);
  const finding = result.findings.find((item) => item.kind === "unmatched");
  assert.equal(finding?.kind, "unmatched");
  if (finding?.kind === "unmatched") {
    assert.deepEqual(finding.counterparts, [read.site, secondRead.site]);
    assert.match(findingLine(finding), /handler\.go:2, other-handler\.go:9/);
  }
});

test("reverse findings name every client call site represented by the endpoint", () => {
  const secondSend: SendSet = { ...send, site: { file: "second-client.ts", line: 12 } };
  const allowed: AllowEntry[] = [{ method: "POST", route: "/items", location: "body", field: "trace_id", reason: "proxy consumes it" }];
  const result = match([send, secondSend], [read], { unmapped: "skip", unresolved: "warn", reverseDirection: true }, allowed);
  const finding = result.findings.find((item) => item.kind === "unmatched" && item.direction === "read-not-sent");
  assert.equal(finding?.kind, "unmatched");
  if (finding?.kind === "unmatched") assert.deepEqual(finding.counterparts, [send.site, secondSend.site]);
});

test("an any-method read pairs with every client method and a specific read wins", () => {
  const rules = { unmapped: "error", unresolved: "warn", reverseDirection: true } as const;
  const anyRead: ReadSet = { method: "*", route: "/status", query: [], body: [], unresolved: [], site: { file: "h.go", line: 4 }, fieldsUnmodeled: true };
  const get: SendSet = { method: "GET", route: "/status", query: [], body: [], unresolved: [], site };
  const post: SendSet = { ...get, method: "POST", site: { file: "example.ts", line: 2 } };
  const mapped = match([get, post], [anyRead], rules, []);
  assert.equal(mapped.summary.unmapped, 0);
  assert.equal(mapped.exitCode, 0);
  const specific: ReadSet = { ...anyRead, method: "GET", query: ["page"], fieldsUnmodeled: false };
  const withField: SendSet = { ...get, query: ["ghost"] };
  const result = match([withField], [anyRead, specific], rules, []);
  assert.equal(result.findings.some((finding) => finding.kind === "unmatched" && finding.field === "ghost"), true);
});

test("fields sent to a fields-unmodeled endpoint are unresolved, never unmatched, and reverse checking skips it", () => {
  const rules = { unmapped: "skip", unresolved: "warn", reverseDirection: true } as const;
  const unmodeled: ReadSet = { method: "POST", route: "/items", query: [], body: [], unresolved: [], site: { file: "h.go", line: 7 }, fieldsUnmodeled: true };
  const withBody = match([send], [unmodeled], rules, []);
  assert.equal(withBody.summary.unmatched, 0);
  assert.equal(withBody.summary.unresolved, 1);
  assert.match(withBody.findings.find((finding) => finding.kind === "unresolved")?.message ?? "", /net\/http handler fields are not analyzed/);
  const noFields = match([{ ...send, body: [] }], [unmodeled], rules, []);
  assert.equal(noFields.summary.unresolved, 0);
  assert.equal(noFields.summary.unmatched, 0);
});

test("an unresolved server registration is always reported, even when no client call pairs with it", () => {
  const rules = { unmapped: "skip", unresolved: "warn", reverseDirection: false } as const;
  const detail = { message: "route pattern cannot be resolved", site: { file: "routes.go", line: 9 } };
  const hidden: ReadSet = { method: "*", route: "<unresolved>", query: [], body: [], unresolved: [detail.message], unresolvedDetails: [detail], site: detail.site, fieldsUnmodeled: true };
  const result = match([], [hidden], rules, []);
  assert.equal(result.summary.unresolved, 1);
});
