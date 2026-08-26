import assert from "node:assert/strict";
import test from "node:test";
import { match } from "./matcher.js";
import type { ReadSet, SendSet } from "./types.js";

const site = { file: "example.ts", line: 1 };
const send: SendSet = { method: "POST", route: "/items", query: [], body: ["name", "trace_id"], unresolved: [], site };
const read: ReadSet = { method: "POST", route: "/items", query: [], body: ["name", "server_only"], unresolved: [], site: { file: "handler.go", line: 2 } };

test("allow entries suppress a matching sent-not-read field", () => {
  const result = match([send], [read], { unmapped: "skip", unresolved: "warn", reverseDirection: false }, [
    { method: "POST", route: "/items", field: "trace_id", reason: "proxy consumes it" },
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.unmatched, 0);
});

test("reverse direction is opt-in", () => {
  const allowed = [{ method: "POST", route: "/items", field: "trace_id", reason: "proxy consumes it" }];
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
