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

test("const object members resolve for plain and as-const literals, nested members, and imports", () => {
  const directory = project(`
    import { REMOTE } from "./paths";
    const LOCAL = { search: "/search", deep: { leaf: "/deep/leaf" } };
    const ALIAS = LOCAL.search;
    void fetch(LOCAL.search + "?limit=1");
    void fetch(\`\${LOCAL.deep.leaf}?page=2\`);
    void fetch(REMOTE.list);
    void fetch(ALIAS);
    void fetch(LOCAL["search"]);
  `);
  fs.writeFileSync(path.join(directory, "src/paths.ts"), `export const REMOTE = { list: "/remote/list" } as const;`);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/search", "/deep/leaf", "/remote/list", "/search", "/search"]);
    assert.deepEqual(sends.map((send) => send.query), [["limit"], ["page"], [], [], []]);
    assert.equal(sends.flatMap((send) => send.unresolved).length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("object members stay unresolved when the object is mutable, reassigned, or not a literal", () => {
  const directory = project(`
    let letObject = { path: "/let" };
    const reassigned = { path: "/before" };
    reassigned.path = "/after";
    const spread = { ...{ path: "/spread" } };
    declare const opaque: { path: string };
    const fromCall = (() => ({ path: "/call" }))();
    const methodHolder = { path() { return "/method"; } };
    void fetch(letObject.path);
    void fetch(reassigned.path);
    void fetch(opaque.path);
    void fetch(fromCall.path);
    void fetch(methodHolder.path);
    void fetch(spread.path);
  `);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.equal(sends.length, 6);
    assert.ok(sends.every((send) => send.route === "<unresolved>" && send.unresolved.some((reason) => reason.includes("computed value"))), JSON.stringify(sends));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("routePrefixStrip removes a prefix only on a segment boundary and leaves other routes alone", () => {
  const directory = project(`
    declare const id: string;
    const IDP = { login: "/api/idp/api/v1/login" };
    void fetch(IDP.login);
    void fetch(\`/api/idp/api/v1/items/\${id}?q=1\`);
    void fetch("/api/idp");
    void fetch("/api/idpx/api/v1/other");
    void fetch("/api/v1/plain");
  `);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"], routePrefixStrip: ["/api/idp"] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/api/v1/login", "/api/v1/items/:param", "/", "/api/idpx/api/v1/other", "/api/v1/plain"]);
    const longest = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"], routePrefixStrip: ["/api", "/api/idp"] }, directory);
    assert.equal(longest[0]?.route, "/api/v1/login");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("an absolute client.include pattern matches files by absolute path", () => {
  const directory = project(`void fetch("/abs");`);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: [`${directory}/src/**/*.ts`] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/abs"]);
    assert.equal(sends[0]?.site.file, "src/client.ts");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("an include set that matches nothing names the patterns instead of failing silently", () => {
  const directory = project(`void fetch("/abs");`);
  try {
    assert.throws(() => extractClient({ tsconfig: "./tsconfig.json", include: ["/nowhere/src/**/*.ts"] }, directory), /client\.include matched no TypeScript source files.*\/nowhere\/src/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("mutating one const object member does not poison an unmutated sibling object", () => {
  const directory = project(`
    const stable = { path: "/stable" };
    const mutated = { path: "/before" };
    mutated.path = "/after";
    void fetch(stable.path);
    void fetch(mutated.path);
  `);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/stable", "<unresolved>"]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
