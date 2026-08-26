import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  dependencyNotes: Record<string, string>;
};

test("TypeScript is exactly pinned because tessera consumes its unstable native API", () => {
  const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PackageManifest;
  assert.equal(manifest.peerDependencies.typescript, "7.0.2");
  assert.equal(manifest.devDependencies.typescript, "7.0.2");
  const note = manifest.dependencyNotes.typescript;
  assert.ok(note);
  assert.match(note, /unstable native API/);
});

test("the legacy TypeScript 6 compatibility package is not added", () => {
  const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PackageManifest;
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
  assert.equal(dependencies["@typescript/typescript6"], undefined);
  const note = manifest.dependencyNotes["@typescript/typescript6"];
  assert.ok(note);
  assert.match(note, /legacy compiler API/);
});
