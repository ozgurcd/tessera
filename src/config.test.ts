import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigError, loadConfig } from "./config.js";

test("JSONC configuration loads and rules receive safe defaults", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-config-"));
  const file = path.join(directory, "tessera.config.json");
  try {
    fs.writeFileSync(file, `{
      // Project configuration
      "client": { "tsconfig": "./tsconfig.json" },
      "server": { "adapter": "go-gin", "root": "./server" }
    }`);
    const loaded = loadConfig(file);
    assert.deepEqual(loaded.config.rules, { unmapped: "skip", unresolved: "warn", reverseDirection: false });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("allow entries without reasons are configuration errors", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-config-"));
  const file = path.join(directory, "tessera.config.json");
  try {
    fs.writeFileSync(file, JSON.stringify({
      client: { tsconfig: "./tsconfig.json" },
      server: { adapter: "go-gin", root: "./server" },
      allow: [{ method: "POST", route: "/legacy", field: "trace_id" }],
    }));
    assert.throws(() => loadConfig(file), ConfigError);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
