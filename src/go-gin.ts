import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./config.js";
import type { ReadSet, ReaderShape, ServerAdapter, ServerConfig, Site } from "./types.js";

type Token = { value: string; kind: "identifier" | "string" | "symbol"; line: number };
type ParsedFile = { absolute: string; relative: string; tokens: Token[] };
type FunctionBody = { file: ParsedFile; tokens: Token[]; line: number };
type Call = { name: string; args: Token[][]; start: number; end: number; line: number };
type StructDefinition = { file: string; tokens: Token[] };
type GroupDefinition = { prefix: string; unresolved: string[] };
type GroupAssignment = { variable: string; receiver: string; route: string; line: number };

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const DEFAULT_READERS: ReaderShape[] = [
  { call: "c.Query", nameArg: 0 },
  { call: "c.DefaultQuery", nameArg: 0 },
  { call: "c.QueryArray", nameArg: 0 },
  { call: "c.GetQuery", nameArg: 0 },
  { call: "c.GetQueryArray", nameArg: 0 },
];

function walk(directory: string): string[] {
  const result: string[] = [];
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "vendor" || entry.name === "testdata") continue;
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(item));
    else if (entry.isFile() && entry.name.endsWith(".go") && !entry.name.endsWith("_test.go")) result.push(item);
  }
  return result;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  for (let index = 0; index < input.length;) {
    const char = input[index]!;
    if (/\s/.test(char)) { if (char === "\n") line += 1; index += 1; continue; }
    if (char === "/" && input[index + 1] === "/") {
      index += 2;
      while (index < input.length && input[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && input[index + 1] === "*") {
      index += 2;
      while (index < input.length - 1 && !(input[index] === "*" && input[index + 1] === "/")) {
        if (input[index] === "\n") line += 1;
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      const startLine = line;
      let raw = "";
      index += 1;
      while (index < input.length && input[index] !== quote) {
        if (input[index] === "\\" && quote !== "`" && index + 1 < input.length) {
          raw += input[index]! + input[index + 1]!;
          index += 2;
        } else {
          if (input[index] === "\n") line += 1;
          raw += input[index]!;
          index += 1;
        }
      }
      index += 1;
      let value = raw;
      if (quote === '"') {
        try { value = JSON.parse(`"${raw}"`) as string; } catch { /* retain raw malformed source */ }
      }
      tokens.push({ value, kind: "string", line: startLine });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (index < input.length && /[A-Za-z\d_]/.test(input[index]!)) index += 1;
      tokens.push({ value: input.slice(start, index), kind: "identifier", line });
      continue;
    }
    const pair = input.slice(index, index + 2);
    if ([":=", "==", "!=", "<=", ">=", "&&", "||", "<-", "++", "--", "..."].includes(pair)) {
      tokens.push({ value: pair, kind: "symbol", line });
      index += 2;
      continue;
    }
    tokens.push({ value: char, kind: "symbol", line });
    index += 1;
  }
  return tokens;
}

function closing(tokens: Token[], start: number, open = "(", close = ")"): number | undefined {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index]!.value === open) depth += 1;
    else if (tokens[index]!.value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function splitArgs(tokens: Token[], start: number, end: number): Token[][] {
  const result: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const token = tokens[index]!;
    if (["(", "{", "["].includes(token.value)) depth += 1;
    else if ([")", "}", "]"].includes(token.value)) depth -= 1;
    if (token.value === "," && depth === 0) { result.push(current); current = []; }
    else current.push(token);
  }
  if (current.length) result.push(current);
  return result;
}

function callAt(tokens: Token[], open: number): Call | undefined {
  if (tokens[open]?.value !== "(") return undefined;
  let start = open - 1;
  if (start < 0 || tokens[start]!.kind !== "identifier") return undefined;
  while (start >= 2 && tokens[start - 1]!.value === "." && tokens[start - 2]!.kind === "identifier") start -= 2;
  const end = closing(tokens, open);
  if (end === undefined) return undefined;
  const name = tokens.slice(start, open).map((token) => token.value).join("");
  return { name, args: splitArgs(tokens, open + 1, end), start, end, line: tokens[start]!.line };
}

function callsIn(tokens: Token[]): Call[] {
  const result: Call[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.value === "(") {
      const call = callAt(tokens, index);
      if (call) result.push(call);
    }
  }
  return result;
}

function normalizeRoute(route: string): string {
  const clean = route.split("?")[0]!.replace(/:([^/]+)/g, ":param").replace(/\*([^/]+)/g, ":param").replace(/\/{2,}/g, "/");
  return clean.length > 1 ? clean.replace(/\/$/, "") : clean;
}

function parseFunctions(file: ParsedFile): Map<string, FunctionBody> {
  const result = new Map<string, FunctionBody>();
  const tokens = file.tokens;
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]!.value !== "func") continue;
    let nameIndex = index + 1;
    if (tokens[nameIndex]!.value === "(") {
      const receiverEnd = closing(tokens, nameIndex);
      if (receiverEnd === undefined) continue;
      nameIndex = receiverEnd + 1;
    }
    const name = tokens[nameIndex];
    if (!name || name.kind !== "identifier") continue;
    let brace = nameIndex + 1;
    while (brace < tokens.length && tokens[brace]!.value !== "{") brace += 1;
    if (brace >= tokens.length) continue;
    const end = closing(tokens, brace, "{", "}");
    if (end === undefined) continue;
    result.set(name.value, { file, tokens: tokens.slice(index, end + 1), line: tokens[index]!.line });
    index = end;
  }
  return result;
}

function structFields(tokens: Token[], tagName: "json" | "form"): string[] {
  const fields = new Set<string>();
  let depth = 0;
  for (const token of tokens) {
    if (token.value === "{") { depth += 1; continue; }
    if (token.value === "}") { depth = Math.max(0, depth - 1); continue; }
    if (token.kind !== "string" || depth !== 0) continue;
    const match = token.value.match(new RegExp(`(?:^|\\s)${tagName}:"([^" ,]+)(?:,[^"]*)?"`));
    if (match?.[1] && match[1] !== "-") fields.add(match[1]);
  }
  return [...fields];
}

function namedStructs(files: ParsedFile[]): Map<string, StructDefinition[]> {
  const result = new Map<string, StructDefinition[]>();
  for (const file of files) {
    const tokens = file.tokens;
    for (let index = 0; index < tokens.length - 3; index += 1) {
      if (tokens[index]!.value !== "type" || tokens[index + 1]!.kind !== "identifier" || tokens[index + 2]!.value !== "struct" || tokens[index + 3]!.value !== "{") continue;
      const end = closing(tokens, index + 3, "{", "}");
      if (end !== undefined) {
        const name = tokens[index + 1]!.value;
        const values = result.get(name) ?? [];
        values.push({ file: file.relative, tokens: tokens.slice(index + 4, end) });
        result.set(name, values);
      }
    }
  }
  return result;
}

function bindingFields(body: FunctionBody, variable: string, structs: Map<string, StructDefinition[]>, tagName: "json" | "form"): { fields: string[]; resolved: boolean } {
  const tokens = body.tokens;
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]!.value === "var" && tokens[index + 1]!.value === variable) {
      let typeIndex = index + 2;
      if (tokens[typeIndex]!.value === "*") typeIndex += 1;
      if (tokens[typeIndex]!.value === "struct" && tokens[typeIndex + 1]!.value === "{") {
        const end = closing(tokens, typeIndex + 1, "{", "}");
        return end === undefined ? { fields: [], resolved: false } : { fields: structFields(tokens.slice(typeIndex + 2, end), tagName), resolved: true };
      }
      const candidates = structs.get(tokens[typeIndex]!.value) ?? [];
      const sameDirectory = candidates.filter((candidate) => path.dirname(candidate.file) === path.dirname(body.file.relative));
      const selected = sameDirectory.length === 1 ? sameDirectory[0] : candidates.length === 1 ? candidates[0] : undefined;
      if (selected) return { fields: structFields(selected.tokens, tagName), resolved: true };
    }
    if (tokens[index]!.value === variable && tokens[index + 1]!.value === ":=" && tokens[index + 2]!.value === "struct" && tokens[index + 3]?.value === "{") {
      const end = closing(tokens, index + 3, "{", "}");
      return end === undefined ? { fields: [], resolved: false } : { fields: structFields(tokens.slice(index + 4, end), tagName), resolved: true };
    }
  }
  return { fields: [], resolved: false };
}

function contextNames(tokens: Token[]): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < tokens.length - 4; index += 1) {
    if (tokens[index]!.kind === "identifier" && tokens[index + 1]!.value === "*" && tokens[index + 2]!.value === "gin" && tokens[index + 3]!.value === "." && tokens[index + 4]!.value === "Context") result.add(tokens[index]!.value);
  }
  return result;
}

function readerArgumentIndex(callName: string, shapes: ReaderShape[], contexts: Set<string>): number | undefined {
  for (const shape of shapes) {
    if (shape.call === callName) return shape.nameArg;
    const expected = shape.call.split(".");
    const actual = callName.split(".");
    if (expected.length === actual.length && expected.length > 1 && expected[0] === "c" && contexts.has(actual[0]!) && expected.slice(1).join(".") === actual.slice(1).join(".")) return shape.nameArg;
  }
  return undefined;
}

function inspectHandler(body: FunctionBody, readerShapes: ReaderShape[], structs: Map<string, StructDefinition[]>): Pick<ReadSet, "query" | "body" | "unresolved"> {
  const query = new Set<string>();
  const fields = new Set<string>();
  const unresolved: string[] = [];
  const shapeMap = new Map(readerShapes.map((shape) => [shape.call, shape.nameArg]));
  const contexts = contextNames(body.tokens);
  for (const call of callsIn(body.tokens)) {
    const nameArg = readerArgumentIndex(call.name, readerShapes, contexts);
    if (nameArg !== undefined) {
      const argument = call.args[nameArg];
      if (argument?.length === 1 && argument[0]!.kind === "string") query.add(argument[0]!.value);
      else unresolved.push(`${body.file.relative}:${call.line} query reader '${call.name}' uses a computed field name`);
    }
    const shortName = call.name.split(".").at(-1);
    const receiver = call.name.split(".")[0];
    const contextBind = receiver !== undefined && contexts.has(receiver) && shortName?.includes("Bind");
    const bodyBind = contextBind && ["ShouldBindJSON", "BindJSON", "ShouldBindWith"].includes(shortName ?? "");
    const queryBind = contextBind && ["ShouldBindQuery", "BindQuery"].includes(shortName ?? "");
    if (bodyBind || queryBind) {
      const argument = call.args[0] ?? [];
      const ampersand = argument.findIndex((token) => token.value === "&");
      const variable = argument[ampersand + 1];
      if (variable?.kind === "identifier") {
        const result = bindingFields(body, variable.value, structs, queryBind ? "form" : "json");
        for (const field of result.fields) (queryBind ? query : fields).add(field);
        if (!result.resolved) unresolved.push(`${body.file.relative}:${call.line} bind target '${variable.value}' cannot be resolved`);
      } else unresolved.push(`${body.file.relative}:${call.line} bind target is computed; cannot analyze`);
    } else if (contextBind) {
      // Generic, URI, and future bind variants are deliberately unresolved:
      // guessing their location would turn an unsupported read into false assurance.
      unresolved.push(`${body.file.relative}:${call.line} bind shape '${call.name}' is not modeled`);
    }
    if (nameArg === undefined && !shapeMap.has(call.name) && !contextBind) {
      const takesContext = call.args.some((argument) => argument.length === 1 && contexts.has(argument[0]!.value));
      const literal = call.args.find((argument) => argument.length === 1 && argument[0]!.kind === "string")?.[0];
      if (takesContext && literal) unresolved.push(`${body.file.relative}:${call.line} possible unconfigured query reader '${call.name}' for '${literal.value}'`);
    }
  }
  return { query: [...query].sort(), body: [...fields].sort(), unresolved: [...new Set(unresolved)] };
}

function handlerFromArgument(argument: Token[], functions: Map<string, FunctionBody[]>, file: ParsedFile): FunctionBody | undefined {
  if (!argument.length) return undefined;
  if (argument[0]!.value === "func") return { file, tokens: argument, line: argument[0]!.line };
  const identifier = argument.find((token) => token.kind === "identifier");
  if (!identifier) return undefined;
  const candidates = functions.get(identifier.value) ?? [];
  const sameDirectory = candidates.filter((candidate) => path.dirname(candidate.file.relative) === path.dirname(file.relative));
  return sameDirectory.length === 1 ? sameDirectory[0] : candidates.length === 1 ? candidates[0] : undefined;
}

function concatenate(prefix: string, route: string): string {
  return normalizeRoute(`${prefix.replace(/\/$/, "")}/${route.replace(/^\//, "")}`);
}

function union(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort();
}

function groupAssignmentAt(tokens: Token[], index: number): GroupAssignment | undefined {
  const variable = tokens[index];
  if (variable?.kind !== "identifier" || tokens[index + 1]?.value !== ":=") return undefined;
  // Group calls are syntactically adjacent to the assignment. Keeping this scan
  // bounded avoids restarting a file-wide search for every declaration.
  const limit = Math.min(tokens.length, index + 8);
  for (let open = index + 2; open < limit; open += 1) {
    if (tokens[open]!.value !== "(") continue;
    const call = callAt(tokens, open);
    if (!call?.name.endsWith(".Group") || call.args[0]?.[0]?.kind !== "string") return undefined;
    return {
      variable: variable.value,
      receiver: call.name.slice(0, -".Group".length),
      route: call.args[0][0]!.value,
      line: variable.line,
    };
  }
  return undefined;
}

export class GoGinAdapter implements ServerAdapter {
  readonly name = "go-gin";

  async extract(input: unknown, configDirectory = process.cwd()): Promise<ReadSet[]> {
    if (!input || typeof input !== "object" || typeof (input as Record<string, unknown>).root !== "string") throw new ConfigError("go-gin adapter requires a server root");
    const config = input as ServerConfig;
    const root = path.resolve(configDirectory, config.root);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new ConfigError(`server root not found: ${config.root}`);
    const files = walk(root).map((absolute) => ({ absolute, relative: path.relative(root, absolute).replaceAll(path.sep, "/"), tokens: tokenize(fs.readFileSync(absolute, "utf8")) }));
    const functions = new Map<string, FunctionBody[]>();
    const functionsByFile = new Map<string, Map<string, FunctionBody>>();
    for (const file of files) {
      const parsed = parseFunctions(file);
      functionsByFile.set(file.absolute, parsed);
      for (const [name, body] of parsed) functions.set(name, [...(functions.get(name) ?? []), body]);
    }
    const structs = namedStructs(files);
    const readerShapes = config.readerShapes?.length ? config.readerShapes : DEFAULT_READERS;
    const results = new Map<string, ReadSet>();

    for (const file of files) {
      for (const scope of functionsByFile.get(file.absolute)?.values() ?? []) {
        const groups = new Map<string, GroupDefinition>();
        const lexicalScopes: Array<Map<string, GroupDefinition | undefined>> = [];
        const assignments = new Map<number, GroupAssignment>();
        const assignmentCounts = new Map<string, number>();
        for (let index = 0; index < scope.tokens.length; index += 1) {
          const assignment = groupAssignmentAt(scope.tokens, index);
          if (!assignment) continue;
          assignments.set(index, assignment);
          assignmentCounts.set(assignment.variable, (assignmentCounts.get(assignment.variable) ?? 0) + 1);
        }

        for (let index = 0; index < scope.tokens.length; index += 1) {
          const token = scope.tokens[index]!;
          if (token.value === "{") {
            lexicalScopes.push(new Map());
            continue;
          }
          if (token.value === "}") {
            for (const [variable, previous] of lexicalScopes.pop() ?? []) {
              if (previous) groups.set(variable, previous);
              else groups.delete(variable);
            }
            continue;
          }
          const assignment = assignments.get(index);
          if (assignment) {
            const parent = groups.get(assignment.receiver);
            const unresolved = [...(parent?.unresolved ?? [])];
            const count = assignmentCounts.get(assignment.variable) ?? 0;
            if (count > 1) unresolved.push(`${file.relative}:${assignment.line} router group variable '${assignment.variable}' is assigned ${count} times in one function; block shadowing cannot be resolved`);
            const lexicalScope = lexicalScopes.at(-1);
            if (lexicalScope && !lexicalScope.has(assignment.variable)) lexicalScope.set(assignment.variable, groups.get(assignment.variable));
            groups.set(assignment.variable, { prefix: concatenate(parent?.prefix ?? "", assignment.route), unresolved });
          }
          if (token.value !== "(") continue;
          const call = callAt(scope.tokens, index);
          if (!call) continue;
          const parts = call.name.split(".");
          const method = parts.at(-1)?.toUpperCase();
          const receiver = parts.slice(0, -1).join(".");
          if (!method || !HTTP_METHODS.has(method) || call.args[0]?.[0]?.kind !== "string") continue;
          const group = groups.get(receiver);
          const route = concatenate(group?.prefix ?? "", call.args[0][0]!.value);
          // Gin accepts variadic middleware, but the final argument is the endpoint
          // handler. Resolving that position fails closed instead of inspecting middleware.
          const handler = handlerFromArgument(call.args.at(-1) ?? [], functions, file);
          const site: Site = { file: file.relative, line: call.line };
          const inspected = handler ? inspectHandler(handler, readerShapes, structs) : { query: [], body: [], unresolved: [`${file.relative}:${call.line} route handler cannot be resolved`] };
          inspected.unresolved.push(...(group?.unresolved ?? []));
          const endpointKey = `${method} ${route}`;
          const handlerSite = handler ? { file: handler.file.relative, line: handler.line } : site;
          const extracted: ReadSet = { method, route, ...inspected, site: handlerSite };
          const existing = results.get(endpointKey);
          if (existing) {
            // Duplicate registrations commonly represent mutually exclusive setup
            // branches. Union can hide a branch-specific miss (a false negative), but
            // intersection makes every fallback handler create floods of false positives.
            // Keep the unresolved note so callers still see that branch parity is unknown.
            results.set(endpointKey, {
              ...existing,
              query: union(existing.query, extracted.query),
              body: union(existing.body, extracted.body),
              unresolved: [...new Set([...existing.unresolved, ...extracted.unresolved, `${file.relative}:${call.line} duplicate route registration cannot be disambiguated`])],
              sites: [...(existing.sites ?? [existing.site]), ...(extracted.sites ?? [extracted.site])],
            });
          } else results.set(endpointKey, extracted);
        }
      }
    }

    for (const [key, relative] of Object.entries(config.routeOverrides ?? {})) {
      const match = key.match(/^([A-Za-z]+)\s+(.+)$/);
      if (!match) continue;
      const method = match[1]!.toUpperCase();
      const route = normalizeRoute(match[2]!);
      const file = files.find((candidate) => candidate.relative === relative.replaceAll("\\", "/"));
      if (!file) {
        const site = { file: relative, line: 1 };
        results.set(`${method} ${route}`, { method, route, query: [], body: [], unresolved: [`${relative}:1 route override file not found`], site });
        continue;
      }
      const bodies = [...(functionsByFile.get(file.absolute)?.values() ?? [])];
      const body = bodies.length === 1 ? bodies[0] : undefined;
      const inspected = body
        ? inspectHandler(body, readerShapes, structs)
        : { query: [], body: [], unresolved: [`${file.relative}:1 route override file has ${bodies.length} functions; handler cannot be disambiguated`] };
      const site = { file: file.relative, line: body?.line ?? 1 };
      results.set(`${method} ${route}`, { method, route, ...inspected, site });
    }
    return [...results.values()].sort((a, b) => a.method.localeCompare(b.method) || a.route.localeCompare(b.route));
  }
}
