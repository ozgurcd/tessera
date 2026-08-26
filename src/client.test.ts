import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractClient } from "./client.js";

function project(source: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-client-"));
  fs.writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM"], strict: true, noEmit: true }, include: ["src/**/*.ts"] }));
  fs.mkdirSync(path.join(directory, "src"));
  fs.writeFileSync(path.join(directory, "src/client.ts"), source);
  return directory;
}

test("fetch aliases and configured wrappers resolve while shadowed fetch is ignored", () => {
  const directory = project(`
    function apiFetch(url: string, options?: RequestInit) { return fetch(url, options); }
    const request = fetch;
    void request("/alias?name=value");
    void apiFetch("/wrapped?mode=full");
    function shadow(fetch: (url: string) => void) { fetch("/shadow?bad=true"); }
  `);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"], fetchWrappers: ["apiFetch"] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/alias", "/wrapped"]);
    assert.deepEqual(sends.map((send) => send.query), [["name"], ["mode"]]);
    assert.equal(sends.flatMap((send) => send.unresolved).length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("interpolated query values are not mistaken for computed field names", () => {
  const directory = project(`
    const value = "hello";
    void fetch(\`/search?query=\${encodeURIComponent(value)}&limit=20\`);
  `);
  try {
    const [send] = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.deepEqual(send?.query, ["limit", "query"]);
    assert.deepEqual(send?.unresolved, []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("Object.assign and non-literal methods are fail-closed", () => {
  const directory = project(`
    const method = Math.random() ? "POST" : "PUT";
    const body = { name: "example" };
    Object.assign(body, { admin_email: "admin@example.test" });
    void fetch("/organizations", { method, body: JSON.stringify(body) });
  `);
  try {
    const [send] = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.deepEqual(send?.body, ["admin_email", "name"]);
    assert.ok(send?.unresolved.some((reason) => reason.includes("HTTP method is computed")));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
