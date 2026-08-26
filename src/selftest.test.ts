import assert from "node:assert/strict";
import test from "node:test";
import { runSelftest } from "./selftest.js";

test("all bundled contract fixtures pass", async () => {
  const result = await runSelftest();
  assert.equal(result.total, 16);
  assert.equal(result.passed, result.total, result.lines.join("\n"));
});
