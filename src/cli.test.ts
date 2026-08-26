import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cli = path.resolve(path.dirname(new URL(import.meta.url).pathname), "cli.js");

test("init detects tsconfig and refuses to overwrite its config", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-init-"));
  try {
    fs.writeFileSync(path.join(directory, "tsconfig.app.json"), "{}");
    const output = execFileSync(process.execPath, [cli, "init", "--json"], { cwd: directory, encoding: "utf8" });
    const parsed = JSON.parse(output) as { schemaVersion: number; tsconfig: string };
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.tsconfig, "tsconfig.app.json");
    assert.match(fs.readFileSync(path.join(directory, "tessera.config.json"), "utf8"), /\.\/tsconfig\.app\.json/);
    const second = spawnSync(process.execPath, [cli, "init"], { cwd: directory, encoding: "utf8" });
    assert.equal(second.status, 2);
    assert.match(second.stderr, /refusing to overwrite/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("JSON check output is versioned and preserves the exit code", () => {
  const config = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../fixtures/01-pagination/tessera.config.json");
  const result = spawnSync(process.execPath, [cli, "check", "--json", "--config", config], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout) as { schemaVersion: number; summary: { unmatched: number } };
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.summary.unmatched, 2);
});
