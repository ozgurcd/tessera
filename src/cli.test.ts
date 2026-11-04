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

const packageVersion = (JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../package.json"), "utf8")) as { version: string }).version;

test("version subcommand prints 'tessera v<version>' and --json the versioned schema object, like the other owner tools", () => {
  const text = spawnSync(process.execPath, [cli, "version"], { encoding: "utf8" });
  assert.equal(text.status, 0);
  assert.equal(text.stdout, `tessera v${packageVersion}\n`);
  const json = spawnSync(process.execPath, [cli, "version", "--json"], { encoding: "utf8" });
  assert.equal(json.status, 0);
  assert.equal(json.stdout, `${JSON.stringify({ schema_version: "tessera.version.v1", version: `v${packageVersion}` })}\n`);
});

test("-v and --version still print the bare version, and --quiet silences version", () => {
  for (const flag of ["-v", "--version"]) assert.equal(spawnSync(process.execPath, [cli, flag], { encoding: "utf8" }).stdout, `${packageVersion}\n`);
  const quiet = spawnSync(process.execPath, [cli, "version", "--quiet"], { encoding: "utf8" });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, "");
});

test("help lists the version subcommand", () => {
  assert.match(spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).stdout, /tessera version\s+Show the installed version \(--json for the schema object\)/);
});
