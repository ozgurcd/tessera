import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./config.js";
import { callAt, callsIn, closing, tokenize, unresolvedAt, uniqueUnresolved, walk, type Token } from "./go-gin.js";
import { ANY_METHOD, UNRESOLVED_ROUTE, type ReadSet, type ServerAdapter, type ServerConfig, type Site, type UnresolvedDetail } from "./types.js";

type GoFile = { relative: string; tokens: Token[] };
type ConstDeclaration = { directory: string; expression: Token[] };
type Evaluated = { value: string } | { reason: string };

const REGISTRARS = new Set(["Handle", "HandleFunc"]);
// ServeMux.Handle(pattern, handler) takes exactly two arguments; Gin-style
// Handle(method, path, handlers...) has more and is not a net/http route.
const REGISTRATION_ARGUMENTS = 2;
const MAX_CONST_DEPTH = 8;
// Default for server.maxMountDepth: nested http.StripPrefix sub-mux mounts followed per registration.
const DEFAULT_MAX_MOUNT_DEPTH = 8;

type FunctionRange = { start: number; end: number };
type Registration = {
  file: GoFile;
  scope: number;
  receiver: string;
  callName: string;
  line: number;
  pattern: Token[];
  handler: Token[];
  /** Set once a StripPrefix mount over a sub-mux claims this registration's routes. */
  mounts: Mount[];
};
// `prefix` is undefined when the StripPrefix argument cannot be resolved to a string.
type Mount = { registration: Registration; prefix: string | undefined; targets: Registration[] };
type Prefixes = { prefixes: string[] } | { reason: string };

function splitStatements(tokens: Token[], from: number, to: number): Token[][] {
  const entries: Token[][] = [];
  let current: Token[] = [];
  for (let index = from; index < to; index += 1) {
    const token = tokens[index]!;
    const previous = current.at(-1);
    if (previous && token.line > previous.line && previous.value !== "+") {
      entries.push(current);
      current = [];
    }
    if (token.value === ";") continue;
    current.push(token);
  }
  if (current.length) entries.push(current);
  return entries;
}

function collectConsts(files: GoFile[]): Map<string, ConstDeclaration[]> {
  const result = new Map<string, ConstDeclaration[]>();
  for (const file of files) {
    const tokens = file.tokens;
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index]!.value !== "const") continue;
      const grouped = tokens[index + 1]?.value === "(";
      let end = grouped ? closing(tokens, index + 1) ?? tokens.length : index + 2;
      // A bare const statement ends at the first line break not continued by '+'.
      if (!grouped) while (end < tokens.length && (tokens[end]!.line === tokens[end - 1]!.line || tokens[end - 1]!.value === "+")) end += 1;
      for (const entry of splitStatements(tokens, index + (grouped ? 2 : 1), end)) {
        const equals = entry.findIndex((token) => token.value === "=");
        if (entry[0]?.kind !== "identifier" || equals < 1 || entry.slice(1, equals).some((token) => token.value === ",")) continue;
        const declarations = result.get(entry[0].value) ?? [];
        declarations.push({ directory: path.dirname(file.relative), expression: entry.slice(equals + 1) });
        result.set(entry[0].value, declarations);
      }
    }
  }
  return result;
}

function evaluate(expression: Token[], directory: string, consts: Map<string, ConstDeclaration[]>, depth = 0): Evaluated {
  if (!expression.length) return { reason: "route pattern cannot be resolved" };
  if (depth > MAX_CONST_DEPTH) return { reason: "route pattern constant nesting is too deep to resolve" };
  let value = "";
  let operand: Token[] = [];
  const flush = (): Evaluated | undefined => {
    const part = evaluateOperand(operand, directory, consts, depth);
    operand = [];
    if ("reason" in part) return part;
    value += part.value;
    return undefined;
  };
  for (const token of expression) {
    if (token.value === "+" && token.kind === "symbol") {
      const failure = flush();
      if (failure) return failure;
    } else operand.push(token);
  }
  return flush() ?? { value };
}

function evaluateOperand(operand: Token[], directory: string, consts: Map<string, ConstDeclaration[]>, depth: number): Evaluated {
  const unresolved: Evaluated = { reason: "route pattern cannot be resolved" };
  if (operand.length === 1 && operand[0]!.kind === "string") return { value: operand[0]!.value };
  const qualified = operand.length === 3 && operand[1]!.value === "." && operand[0]!.kind === "identifier" && operand[2]!.kind === "identifier";
  if (!(operand.length === 1 && operand[0]!.kind === "identifier") && !qualified) return unresolved;
  const name = operand.at(-1)!.value;
  const candidates = consts.get(name) ?? [];
  const local = qualified ? [] : candidates.filter((candidate) => candidate.directory === directory);
  const chosen = local.length ? local : candidates;
  if (!chosen.length) return unresolved;
  const values = new Set<string>();
  for (const candidate of chosen) {
    const evaluated = evaluate(candidate.expression, candidate.directory, consts, depth + 1);
    if ("reason" in evaluated) return evaluated;
    values.add(evaluated.value);
  }
  return values.size === 1 ? { value: [...values][0]! } : { reason: `route pattern constant '${name}' is declared more than once with different values` };
}

function normalizePath(pathPattern: string): { route: string; subtree: boolean } {
  const segments = pathPattern.split("/").map((segment) => (segment === "{$}" ? "" : /^\{[^}]+\}$/.test(segment) ? ":param" : segment));
  // `/dir/` and a trailing `{rest...}` serve everything below them; the root pattern is deliberately not
  // a subtree, or one catch-all registration would hide every unmapped client route.
  const slashSubtree = pathPattern.length > 1 && pathPattern.endsWith("/");
  const restSubtree = /\/\{[^}]+\.\.\.\}$/.test(pathPattern);
  const joined = `${segments.join("/")}${slashSubtree ? ":param" : ""}`.replace(/\/{2,}/g, "/");
  return { route: joined.length > 1 ? joined.replace(/\/$/, "") : joined || "/", subtree: slashSubtree || restSubtree };
}

/** Parses a Go 1.22 pattern, `[METHOD ][HOST]/path`; anything else is not a route. */
function parsePattern(pattern: string): { method: string; route: string; subtree: boolean } | undefined {
  const match = pattern.match(/^(?:([A-Z]+)[ \t]+)?[^\s/]*(\/\S*)$/);
  return match ? { method: match[1] ?? ANY_METHOD, ...normalizePath(match[2]!) } : undefined;
}

// Two adjacent identifiers form a parameter or field declaration such as
// `pattern string`, so a method definition named Handle is not a registration.
function looksLikeExpression(tokens: Token[]): boolean {
  return tokens.length > 0 && !tokens.some((token, index) => token.kind === "identifier" && tokens[index + 1]?.kind === "identifier");
}

function endpoint(route: string, method: string, site: Site, details: UnresolvedDetail[], subtree = false): ReadSet {
  return { method, route, query: [], body: [], unresolved: details.map((detail) => detail.message), ...(details.length ? { unresolvedDetails: details } : {}), site, fieldsUnmodeled: true, ...(subtree ? { subtree: true } : {}) };
}

/** Named function bodies as token ranges; an anonymous func literal belongs to its enclosing named function. */
function functionRanges(tokens: Token[]): FunctionRange[] {
  const ranges: FunctionRange[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.value !== "func") continue;
    let name = index + 1;
    if (tokens[name]?.value === "(") {
      // A method receiver precedes its name; an anonymous literal's parenthesis is its parameter list.
      const receiverEnd = closing(tokens, name);
      if (receiverEnd === undefined || tokens[receiverEnd + 1]?.kind !== "identifier") continue;
      name = receiverEnd + 1;
    }
    if (tokens[name]?.kind !== "identifier") continue;
    let brace = name + 1;
    if (tokens[brace]?.value === "(") brace = (closing(tokens, brace) ?? brace) + 1;
    while (brace < tokens.length && tokens[brace]!.value !== "{") brace += 1;
    const end = closing(tokens, brace, "{", "}");
    if (end === undefined) continue;
    ranges.push({ start: index, end });
    index = end;
  }
  return ranges;
}

/** `http.StripPrefix(prefix, target)` spanning the whole handler argument. */
function stripPrefixCall(handler: Token[]): { prefix: Token[]; target: Token[] } | undefined {
  const open = handler.findIndex((token) => token.value === "(");
  const call = open > 0 ? callAt(handler, open) : undefined;
  if (!call || call.start !== 0 || call.end !== handler.length - 1 || call.name.split(".").at(-1) !== "StripPrefix" || call.args.length !== 2) return undefined;
  return { prefix: call.args[0]!, target: call.args[1]! };
}

const pathText = (tokens: Token[]): string | undefined =>
  tokens.length && tokens.every((token, index) => (index % 2 === 0 ? token.kind === "identifier" : token.value === ".")) && tokens.length % 2 === 1 ? tokens.map((token) => token.value).join("") : undefined;

/**
 * Maps net/http registrations (`HandleFunc` and `Handle`) to endpoints. Routes
 * only: handler field reads are not modeled, so every endpoint is marked
 * `fieldsUnmodeled` and the matcher reports sent fields as unresolved.
 */
export class GoNetHttpAdapter implements ServerAdapter {
  readonly name = "go-nethttp";

  async extract(input: unknown, configDirectory = process.cwd()): Promise<ReadSet[]> {
    if (!input || typeof input !== "object" || typeof (input as Record<string, unknown>).root !== "string") throw new ConfigError("go-nethttp adapter requires a server root");
    const config = input as ServerConfig;
    const root = path.resolve(configDirectory, config.root);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new ConfigError(`server root not found: ${config.root}`);
    const files = walk(root)
      .map((absolute) => ({ relative: path.relative(root, absolute).replaceAll(path.sep, "/"), tokens: tokenize(fs.readFileSync(absolute, "utf8")) }))
      .sort((a, b) => a.relative.localeCompare(b.relative));
    const consts = collectConsts(files);
    const maxMountDepth = config.maxMountDepth ?? DEFAULT_MAX_MOUNT_DEPTH;
    const registrations: Registration[] = [];
    const functionScopes = new Map<string, Array<{ file: GoFile; scope: number }>>();
    for (const file of files) {
      const ranges = functionRanges(file.tokens);
      for (const [scope, range] of ranges.entries()) {
        const name = file.tokens[range.start + 1]?.value === "(" ? file.tokens[(closing(file.tokens, range.start + 1) ?? range.start) + 1]?.value : file.tokens[range.start + 1]?.value;
        if (name) functionScopes.set(name, [...(functionScopes.get(name) ?? []), { file, scope }]);
      }
      for (const call of callsIn(file.tokens)) {
        if (!REGISTRARS.has(call.name.split(".").at(-1)!) || call.args.length !== REGISTRATION_ARGUMENTS || file.tokens[call.start - 1]?.value === "func") continue;
        registrations.push({
          file,
          scope: ranges.findIndex((range) => call.start > range.start && call.start < range.end),
          receiver: call.name.split(".").slice(0, -1).join("."),
          callName: call.name,
          line: call.line,
          pattern: call.args[0]!,
          handler: call.args[1]!,
          mounts: [],
        });
      }
    }

    // An http.StripPrefix(prefix, X) handler whose X is a mux with registrations of its own is a sub-mux
    // mount: X's routes live below the stripped prefix and the mount's own pattern is not a route.
    const mounts: Mount[] = [];
    const mountDetails: Array<{ registration: Registration; reason: string }> = [];
    for (const registration of registrations) {
      const strip = stripPrefixCall(registration.handler);
      if (!strip) continue;
      const targetPath = pathText(strip.target);
      const targetCall = strip.target.length > 2 && strip.target.at(-1)?.value === ")" && strip.target[1]?.value === "(" ? strip.target[0]!.value : undefined;
      const targets = registrations.filter((candidate) => {
        if (candidate === registration) return false;
        if (targetPath !== undefined) return candidate.receiver === targetPath && ((candidate.file === registration.file && candidate.scope === registration.scope) || path.dirname(candidate.file.relative) === path.dirname(registration.file.relative));
        return targetCall !== undefined && (functionScopes.get(targetCall) ?? []).some((fn) => fn.file === candidate.file && fn.scope === candidate.scope && path.dirname(fn.file.relative) === path.dirname(registration.file.relative));
      });
      // A same-scope receiver is the mux in view; only when there is none is a same-package receiver of that name used.
      const local = targets.filter((candidate) => candidate.file === registration.file && candidate.scope === registration.scope);
      const chosen = targetPath !== undefined && local.length ? local : targets;
      if (!chosen.length) continue;
      const evaluated = evaluate(strip.prefix, path.dirname(registration.file.relative), consts);
      const mount: Mount = { registration, prefix: "reason" in evaluated ? undefined : evaluated.value.replace(/\/+$/, ""), targets: chosen };
      if (mount.prefix === undefined || !mount.prefix.startsWith("/")) {
        mountDetails.push({ registration, reason: "http.StripPrefix prefix cannot be resolved to a path; the routes of the mounted sub-mux are not registered" });
        mount.prefix = undefined;
      }
      mounts.push(mount);
      for (const target of chosen) target.mounts.push(mount);
    }
    const consumed = new Set(mounts.map((mount) => mount.registration));

    const prefixesOf = (registration: Registration, depth: number, seen: Set<Registration>): Prefixes => {
      if (!registration.mounts.length) return { prefixes: [""] };
      if (depth >= maxMountDepth || seen.has(registration)) return { reason: `http.StripPrefix mounts nest deeper than maxMountDepth (${maxMountDepth}) or form a cycle; the routes of this sub-mux are not registered` };
      const result = new Set<string>();
      for (const mount of registration.mounts) {
        if (mount.prefix === undefined) return { reason: "http.StripPrefix prefix cannot be resolved to a path; the routes of the mounted sub-mux are not registered" };
        const outer = prefixesOf(mount.registration, depth + 1, new Set([...seen, registration]));
        if ("reason" in outer) return outer;
        for (const prefix of outer.prefixes) result.add(`${prefix}${mount.prefix}`);
      }
      return { prefixes: [...result] };
    };

    const results = new Map<string, ReadSet>();
    const unresolved: UnresolvedDetail[] = [];
    const unresolvedSites: Site[] = [];
    const report = (file: string, line: number, reason: string): void => {
      unresolved.push(unresolvedAt(file, line, reason));
      unresolvedSites.push({ file, line });
    };
    for (const { registration, reason } of mountDetails) report(registration.file.relative, registration.line, reason);

    for (const registration of registrations) {
      if (consumed.has(registration)) continue;
      const file = registration.file;
      const site: Site = { file: file.relative, line: registration.line };
      const evaluated = evaluate(registration.pattern, path.dirname(file.relative), consts);
      if ("reason" in evaluated) {
        if (looksLikeExpression(registration.pattern)) report(file.relative, registration.line, evaluated.reason);
        continue;
      }
      const parsed = parsePattern(evaluated.value);
      if (!parsed) continue;
      const outer = prefixesOf(registration, 0, new Set());
      if ("reason" in outer) {
        // The mount of a mount is reported once, at the registration it hides.
        report(file.relative, registration.line, outer.reason);
        continue;
      }
      for (const prefix of outer.prefixes) {
        const route = parsed.route === "/" ? prefix || "/" : `${prefix}${parsed.route}`;
        const key = `${parsed.method} ${route}`;
        const existing = results.get(key);
        if (existing) results.set(key, { ...existing, sites: [...(existing.sites ?? [existing.site]), site] });
        else results.set(key, endpoint(route, parsed.method, site, [], parsed.subtree));
      }
    }
    if (unresolved.length) {
      const details = uniqueUnresolved(unresolved);
      results.set(`${ANY_METHOD} ${UNRESOLVED_ROUTE}`, { ...endpoint(UNRESOLVED_ROUTE, ANY_METHOD, unresolvedSites[0]!, details), sites: unresolvedSites });
    }
    return [...results.values()].sort((a, b) => a.method.localeCompare(b.method) || a.route.localeCompare(b.route));
  }
}
