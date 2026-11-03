import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./config.js";
import { callsIn, closing, tokenize, unresolvedAt, uniqueUnresolved, walk, type Token } from "./go-gin.js";
import { ANY_METHOD, UNRESOLVED_ROUTE, type ReadSet, type ServerAdapter, type ServerConfig, type Site, type UnresolvedDetail } from "./types.js";

type GoFile = { relative: string; tokens: Token[] };
type ConstDeclaration = { directory: string; expression: Token[] };
type Evaluated = { value: string } | { reason: string };

const REGISTRARS = new Set(["Handle", "HandleFunc"]);
// ServeMux.Handle(pattern, handler) takes exactly two arguments; Gin-style
// Handle(method, path, handlers...) has more and is not a net/http route.
const REGISTRATION_ARGUMENTS = 2;
const MAX_CONST_DEPTH = 8;

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

function normalizePath(pathPattern: string): string {
  const segments = pathPattern.split("/").map((segment) => (segment === "{$}" ? "" : /^\{[^}]+\}$/.test(segment) ? ":param" : segment));
  const subtree = pathPattern.length > 1 && pathPattern.endsWith("/");
  const joined = `${segments.join("/")}${subtree ? ":param" : ""}`.replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined || "/";
}

/** Parses a Go 1.22 pattern, `[METHOD ][HOST]/path`; anything else is not a route. */
function parsePattern(pattern: string): { method: string; route: string } | undefined {
  const match = pattern.match(/^(?:([A-Z]+)[ \t]+)?[^\s/]*(\/\S*)$/);
  return match ? { method: match[1] ?? ANY_METHOD, route: normalizePath(match[2]!) } : undefined;
}

// Two adjacent identifiers form a parameter or field declaration such as
// `pattern string`, so a method definition named Handle is not a registration.
function looksLikeExpression(tokens: Token[]): boolean {
  return tokens.length > 0 && !tokens.some((token, index) => token.kind === "identifier" && tokens[index + 1]?.kind === "identifier");
}

function endpoint(route: string, method: string, site: Site, details: UnresolvedDetail[]): ReadSet {
  return { method, route, query: [], body: [], unresolved: details.map((detail) => detail.message), ...(details.length ? { unresolvedDetails: details } : {}), site, fieldsUnmodeled: true };
}

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
    const results = new Map<string, ReadSet>();
    const unresolved: UnresolvedDetail[] = [];
    const unresolvedSites: Site[] = [];

    for (const file of files) {
      for (const call of callsIn(file.tokens)) {
        if (!REGISTRARS.has(call.name.split(".").at(-1)!) || call.args.length !== REGISTRATION_ARGUMENTS || file.tokens[call.start - 1]?.value === "func") continue;
        const patternArgument = call.args[0]!;
        const site: Site = { file: file.relative, line: call.line };
        const evaluated = evaluate(patternArgument, path.dirname(file.relative), consts);
        if ("reason" in evaluated) {
          if (looksLikeExpression(patternArgument)) {
            unresolved.push(unresolvedAt(file.relative, call.line, evaluated.reason));
            unresolvedSites.push(site);
          }
          continue;
        }
        const parsed = parsePattern(evaluated.value);
        if (!parsed) continue;
        const key = `${parsed.method} ${parsed.route}`;
        const existing = results.get(key);
        if (existing) results.set(key, { ...existing, sites: [...(existing.sites ?? [existing.site]), site] });
        else results.set(key, endpoint(parsed.route, parsed.method, site, []));
      }
    }
    if (unresolved.length) {
      const details = uniqueUnresolved(unresolved);
      results.set(`${ANY_METHOD} ${UNRESOLVED_ROUTE}`, { ...endpoint(UNRESOLVED_ROUTE, ANY_METHOD, unresolvedSites[0]!, details), sites: unresolvedSites });
    }
    return [...results.values()].sort((a, b) => a.method.localeCompare(b.method) || a.route.localeCompare(b.route));
  }
}
