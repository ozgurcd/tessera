import fs from "node:fs";
import path from "node:path";
import { API, SymbolFlags, TypeFlags, type Checker, type Symbol as CompilerSymbol } from "typescript/unstable/sync";
import * as ts from "typescript/unstable/ast";
import { ConfigError } from "./config.js";
import type { ClientConfig, SendSet, Site } from "./types.js";

type Segment = { kind: "text"; value: string } | { kind: "expression"; value: ts.Expression };
type UrlAnalysis = { routes?: string[]; query: Set<string>; queryExpressions: ts.Expression[]; reasons: string[] };
type PathExpression = { kind: "literals"; values: string[] } | { kind: "parameter" } | { kind: "unresolved" };

function siteFor(node: ts.Node, root: string): Site {
  const source = node.getSourceFile();
  return { file: path.relative(root, source.fileName).replaceAll(path.sep, "/"), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 };
}

function globRegex(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  let output = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]!;
    if (char === "*" && normalized[i + 1] === "*") {
      i += 1;
      if (normalized[i + 1] === "/") {
        i += 1;
        output += "(?:.*/)?";
      } else output += ".*";
    } else if (char === "*") output += "[^/]*";
    else if (char === "?") output += "[^/]";
    else output += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${output}$`);
}

function propertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteralLikeNode(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node) && (ts.isStringLiteralLikeNode(node.expression) || ts.isNumericLiteral(node.expression))) return node.expression.text;
  return undefined;
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (true) {
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertion(expression) || ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
    else break;
  }
  return expression;
}

function declarationOf(symbol: CompilerSymbol): ts.Node | undefined {
  return symbol.valueDeclaration?.resolve() ?? symbol.declarations[0]?.resolve();
}

function initializerOf(expression: ts.Expression, checker: Checker, seen = new Set<CompilerSymbol>()): ts.Expression {
  expression = unwrap(expression);
  if (!ts.isIdentifier(expression)) return expression;
  const symbol = checker.getSymbolAtLocation(expression);
  if (!symbol || seen.has(symbol)) return expression;
  seen.add(symbol);
  const declaration = declarationOf(symbol);
  if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return initializerOf(declaration.initializer, checker, seen);
  return expression;
}

function symbolAt(expression: ts.Expression, checker: Checker): CompilerSymbol | undefined {
  expression = unwrap(expression);
  let symbol = checker.getSymbolAtLocation(expression);
  if (symbol && (symbol.flags & SymbolFlags.Alias)) {
    try { symbol = checker.getAliasedSymbol(symbol); } catch { /* malformed programs can expose unresolved aliases */ }
  }
  return symbol;
}

function rootCalleeName(expression: ts.Expression, checker: Checker, seen = new Set<CompilerSymbol>()): { name: string; library: boolean } | undefined {
  expression = unwrap(expression);
  const symbol = symbolAt(expression, checker);
  if (symbol && !seen.has(symbol)) {
    seen.add(symbol);
    const declaration = declarationOf(symbol);
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const result = rootCalleeName(declaration.initializer, checker, seen);
      if (result) return result;
    }
    const library = symbol.declarations.some((item) => {
      const node = item.resolve();
      return Boolean(node?.getSourceFile().isDeclarationFile && /(?:lib\.dom|undici|@types\/node)/.test(node.getSourceFile().fileName));
    });
    return { name: symbol.name, library };
  }
  if (ts.isPropertyAccessExpression(expression)) return { name: expression.name.text, library: false };
  if (ts.isIdentifier(expression)) return { name: expression.text, library: false };
  return undefined;
}

function isConfiguredCall(expression: ts.Expression, checker: Checker, wrappers: Set<string>): boolean {
  const root = rootCalleeName(expression, checker);
  return Boolean(root && ((root.name === "fetch" && root.library) || wrappers.has(root.name)));
}

function isInsideConfiguredWrapper(node: ts.Node, wrappers: Set<string>): boolean {
  for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name && wrappers.has(current.name.text)) return true;
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name) && wrappers.has(current.parent.name.text)) return true;
  }
  return false;
}

function expressionSegments(expression: ts.Expression, checker: Checker, seen = new Set<CompilerSymbol>()): Segment[] | undefined {
  expression = unwrap(expression);
  if (ts.isStringLiteralLikeNode(expression)) return [{ kind: "text", value: expression.text }];
  if (ts.isTemplateExpression(expression)) {
    const result: Segment[] = [{ kind: "text", value: expression.head.text }];
    for (const span of expression.templateSpans) {
      const nested = expressionSegments(span.expression, checker, new Set(seen));
      const contributesPath = nested?.some((segment) => segment.kind === "text" && segment.value.includes("/"));
      result.push(...(contributesPath ? nested! : [{ kind: "expression" as const, value: span.expression }]));
      result.push({ kind: "text", value: span.literal.text });
    }
    return result;
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = expressionSegments(expression.left, checker, seen);
    const right = expressionSegments(expression.right, checker, seen);
    return left && right ? [...left, ...right] : undefined;
  }
  if (ts.isIdentifier(expression)) {
    const symbol = symbolAt(expression, checker);
    if (!symbol || seen.has(symbol)) return undefined;
    seen.add(symbol);
    const declaration = declarationOf(symbol);
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return expressionSegments(declaration.initializer, checker, seen);
  }
  return [{ kind: "expression", value: expression }];
}

function pathExpression(expression: ts.Expression, checker: Checker): PathExpression {
  const type = checker.getTypeAtLocation(expression);
  if (!type) return { kind: "unresolved" };
  if (type.isStringLiteralType()) return { kind: "parameter" };
  if (!type.isUnionType()) return { kind: "parameter" };
  const members = type.getTypes();
  const values: string[] = [];
  for (const member of members) {
    if (!member.isStringLiteralType()) return { kind: "unresolved" };
    values.push(member.value);
  }
  if (!values.length) return { kind: "unresolved" };
  return { kind: "literals", values: [...new Set(values)].sort() };
}

function addLiteralQuery(text: string, result: Set<string>): void {
  for (const piece of text.split("&")) {
    const raw = piece.split("=", 1)[0]?.trim();
    if (raw) {
      try { result.add(decodeURIComponent(raw.replaceAll("+", " "))); } catch { result.add(raw); }
    }
  }
}

function analyzeUrl(expression: ts.Expression, checker: Checker): UrlAnalysis {
  const segments = expressionSegments(expression, checker);
  const output: UrlAnalysis = { query: new Set(), queryExpressions: [], reasons: [] };
  if (!segments) {
    output.reasons.push("URL is a computed value; cannot analyze");
    return output;
  }
  let routes = [""];
  let pathStarted = false;
  let pathUnresolved = false;
  let queryStarted = false;
  let queryTail = "";
  for (const segment of segments) {
    if (segment.kind === "expression") {
      if (queryStarted) {
        if (!queryTail) output.queryExpressions.push(segment.value);
        else if (!queryTail.includes("=")) output.reasons.push("query string uses a computed field name");
      }
      else if (pathStarted && !pathUnresolved) {
        const path = pathExpression(segment.value, checker);
        if (path.kind === "literals") routes = routes.flatMap((route) => path.values.map((value) => `${route}${value}`));
        else if (path.kind === "parameter") routes = routes.map((route) => `${route}/:param`.replace("//", "/"));
        else {
          pathUnresolved = true;
          output.reasons.push("path segment has a non-finite union type; cannot analyze route");
        }
      }
      continue;
    }
    let text = segment.value;
    if (!pathStarted) {
      const scheme = text.match(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i);
      if (scheme) text = text.slice(scheme[0].length);
      const start = text.indexOf("/");
      if (start >= 0) {
        text = text.slice(start);
        pathStarted = true;
      } else if (text && segments.length === 1) {
        text = `/${text}`;
        pathStarted = true;
      } else continue;
    }
    const question = text.indexOf("?");
    if (!queryStarted && question >= 0) {
      routes = routes.map((route) => route + text.slice(0, question));
      queryStarted = true;
      const queryText = text.slice(question + 1);
      addLiteralQuery(queryText, output.query);
      queryTail = queryText.split("&").at(-1) ?? "";
    } else if (queryStarted) {
      addLiteralQuery(text, output.query);
      queryTail = text.includes("&") ? text.split("&").at(-1) ?? "" : `${queryTail}${text}`;
    }
    else routes = routes.map((route) => route + text);
  }
  if (!pathStarted) output.reasons.push("URL route is a computed value; cannot analyze");
  else if (!pathUnresolved) output.routes = [...new Set(routes.map((route) => route.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/"))];
  return output;
}

function calledDeclaration(call: ts.CallExpression, checker: Checker): ts.SignatureDeclaration | undefined {
  const declaration = checker.getResolvedSignature(call)?.declaration?.resolve();
  return declaration && ts.isSignatureDeclaration(declaration) ? declaration : undefined;
}

function collectRelatedSymbols(seed: CompilerSymbol, source: ts.SourceFile, checker: Checker): Set<CompilerSymbol> {
  const related = new Set<CompilerSymbol>([seed]);
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        const target = symbolAt(node.name, checker);
        const sourceSymbol = symbolAt(unwrap(node.initializer), checker);
        if (target && sourceSymbol && (related.has(target) || related.has(sourceSymbol))) {
          if (!related.has(target)) { related.add(target); changed = true; }
          if (!related.has(sourceSymbol)) { related.add(sourceSymbol); changed = true; }
        }
      }
      if (ts.isCallExpression(node)) {
        const declaration = calledDeclaration(node, checker);
        if (declaration) {
          node.arguments.forEach((argument, index) => {
            const argumentSymbol = symbolAt(unwrap(argument), checker);
            const parameter = declaration.parameters[index];
            if (argumentSymbol && related.has(argumentSymbol) && parameter && ts.isIdentifier(parameter.name)) {
              const parameterSymbol = symbolAt(parameter.name, checker);
              if (parameterSymbol && !related.has(parameterSymbol)) { related.add(parameterSymbol); changed = true; }
            }
          });
        }
      }
      node.forEachChild(visit);
    };
    visit(source);
  }
  return related;
}

function queryFromExpression(expression: ts.Expression, checker: Checker): { fields: Set<string>; reasons: string[] } {
  const fields = new Set<string>();
  const reasons: string[] = [];
  expression = unwrap(expression);
  const source = expression.getSourceFile();
  const identifiers: ts.Identifier[] = [];
  const gather = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.push(node);
    node.forEachChild(gather);
  };
  gather(expression);
  for (const identifier of identifiers) {
    const seed = symbolAt(identifier, checker);
    if (!seed) continue;
    const declaration = declarationOf(seed);
    const initial = declaration && ts.isVariableDeclaration(declaration) && declaration.initializer ? unwrap(declaration.initializer) : undefined;
    const isParams = initial && ts.isNewExpression(initial) && ts.isIdentifier(initial.expression) && initial.expression.text === "URLSearchParams";
    if (!isParams) continue;
    const constructorArg = initial.arguments?.[0];
    if (constructorArg && ts.isObjectLiteralExpression(unwrap(constructorArg))) {
      for (const property of (unwrap(constructorArg) as ts.ObjectLiteralExpression).properties) {
        if (!ts.isSpreadAssignment(property) && property.name) {
          const name = propertyName(property.name);
          if (name) fields.add(name); else reasons.push("URLSearchParams has a computed field name");
        }
      }
    } else if (constructorArg) reasons.push("URLSearchParams constructor input is computed; cannot analyze");
    const related = collectRelatedSymbols(seed, source, checker);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && (node.expression.name.text === "set" || node.expression.name.text === "append")) {
        const receiver = symbolAt(unwrap(node.expression.expression), checker);
        if (receiver && related.has(receiver)) {
          const name = node.arguments[0];
          if (name && ts.isStringLiteralLikeNode(unwrap(name))) fields.add((unwrap(name) as ts.StringLiteralLikeNode).text);
          else reasons.push("URLSearchParams uses a computed field name");
        }
      }
      node.forEachChild(visit);
    };
    visit(source);
  }
  if (!identifiers.some((identifier) => {
    const symbol = symbolAt(identifier, checker);
    if (!symbol) return false;
    const declaration = declarationOf(symbol);
    const initial = declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
    return Boolean(initial && ts.isNewExpression(unwrap(initial)) && ts.isIdentifier((unwrap(initial) as ts.NewExpression).expression) && ((unwrap(initial) as ts.NewExpression).expression as ts.Identifier).text === "URLSearchParams");
  })) reasons.push("query expression is computed and is not a resolvable URLSearchParams value");
  return { fields, reasons };
}

function collectObject(expression: ts.Expression, checker: Checker, keys: Set<string>, reasons: string[], seen = new Set<CompilerSymbol>()): void {
  expression = unwrap(expression);
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) {
        const type = checker.getTypeAtLocation(property.expression);
        const properties = type ? checker.getPropertiesOfType(type) : [];
        if (!type || (!properties.length && !(type.flags & TypeFlags.Object))) reasons.push("body spread type has no statically known fields");
        for (const item of properties) keys.add(item.name);
      } else if (property.name) {
        const name = propertyName(property.name);
        if (name) keys.add(name); else reasons.push("body has a computed field name");
      }
    }
    return;
  }
  if (!ts.isIdentifier(expression)) {
    reasons.push("body is a computed value; cannot analyze");
    return;
  }
  const symbol = symbolAt(expression, checker);
  if (!symbol || seen.has(symbol)) {
    reasons.push("body identifier cannot be resolved");
    return;
  }
  seen.add(symbol);
  const declaration = declarationOf(symbol);
  if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) {
    reasons.push(`body '${expression.text}' has no analyzable initializer`);
    return;
  }
  const initial = unwrap(declaration.initializer);
  if (ts.isObjectLiteralExpression(initial) || ts.isIdentifier(initial)) collectObject(initial, checker, keys, reasons, seen);
  else reasons.push(`body '${expression.text}' is initialized from a computed value`);

  const related = collectRelatedSymbols(symbol, expression.getSourceFile(), checker);
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrap(node.left);
      if (ts.isPropertyAccessExpression(left)) {
        const receiver = symbolAt(unwrap(left.expression), checker);
        if (receiver && related.has(receiver)) keys.add(left.name.text);
      } else if (ts.isElementAccessExpression(left)) {
        const receiver = symbolAt(unwrap(left.expression), checker);
        if (receiver && related.has(receiver)) {
          const argument = left.argumentExpression && unwrap(left.argumentExpression);
          if (argument && ts.isStringLiteralLikeNode(argument)) keys.add(argument.text);
          else reasons.push("body has a computed field assignment");
        }
      } else if (ts.isIdentifier(left) && related.has(symbolAt(left, checker)!)) {
        collectObject(node.right, checker, keys, reasons, seen);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object" && node.expression.name.text === "assign") {
      const target = node.arguments[0];
      if (target && related.has(symbolAt(unwrap(target), checker)!)) {
        for (const source of node.arguments.slice(1)) collectObject(source, checker, keys, reasons, seen);
      }
    }
    node.forEachChild(visit);
  };
  visit(expression.getSourceFile());
}

function optionsObject(expression: ts.Expression | undefined, checker: Checker): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined;
  const resolved = initializerOf(expression, checker);
  return ts.isObjectLiteralExpression(resolved) ? resolved : undefined;
}

function namedOption(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name && propertyName(property.name) === name) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) return property.name;
  }
  return undefined;
}

function analyzeCall(call: ts.CallExpression, checker: Checker, root: string): SendSet[] {
  const site = siteFor(call, root);
  const unresolved: string[] = [];
  const urlArg = call.arguments[0];
  const url = urlArg ? analyzeUrl(urlArg, checker) : { query: new Set<string>(), queryExpressions: [], reasons: ["missing URL argument"] };
  unresolved.push(...url.reasons);
  const options = optionsObject(call.arguments[1], checker);
  let method = "GET";
  const body = new Set<string>();
  if (call.arguments[1] && !options) unresolved.push("request options are computed; cannot analyze method or body");
  if (options) {
    const methodExpression = namedOption(options, "method");
    if (methodExpression) {
      const resolved = initializerOf(methodExpression, checker);
      if (ts.isStringLiteralLikeNode(resolved)) method = resolved.text.toUpperCase();
      else unresolved.push("HTTP method is computed; cannot analyze");
    }
    const bodyExpression = namedOption(options, "body");
    if (bodyExpression) {
      const resolvedBody = unwrap(bodyExpression);
      if (ts.isCallExpression(resolvedBody) && ts.isPropertyAccessExpression(resolvedBody.expression) && ts.isIdentifier(resolvedBody.expression.expression) && resolvedBody.expression.expression.text === "JSON" && resolvedBody.expression.name.text === "stringify" && resolvedBody.arguments[0]) {
        collectObject(resolvedBody.arguments[0], checker, body, unresolved);
      } else unresolved.push("body is not a statically analyzable JSON.stringify call");
    }
  }
  const query = new Set(url.query);
  for (const expression of url.queryExpressions) {
    const result = queryFromExpression(expression, checker);
    for (const field of result.fields) query.add(field);
    unresolved.push(...result.reasons);
  }
  return (url.routes?.length ? url.routes : ["<unresolved>"]).map((route) => ({
    method,
    route,
    query: [...query].sort(),
    body: [...body].sort(),
    unresolved: [...new Set(unresolved)],
    site,
  }));
}

export function extractClient(config: ClientConfig, configDirectory: string): SendSet[] {
  const tsconfigPath = path.resolve(configDirectory, config.tsconfig);
  if (!fs.existsSync(tsconfigPath)) throw new ConfigError(`tsconfig not found: ${config.tsconfig}`);
  const api = new API({ cwd: path.dirname(tsconfigPath) });
  const parsed = api.parseConfigFile(tsconfigPath);
  const patterns = config.include?.map(globRegex);
  const root = configDirectory;
  const files = parsed.fileNames.filter((file) => {
    if (file.endsWith(".d.ts")) return false;
    if (!patterns?.length) return true;
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    return patterns.some((pattern) => pattern.test(relative));
  });
  if (!files.length) { api.close(); throw new ConfigError("client.include matched no TypeScript source files"); }
  const snapshot = api.updateSnapshot({ openProjects: [tsconfigPath] });
  const project = snapshot.getProject(tsconfigPath) ?? snapshot.getProjects().find((item) => path.resolve(item.configFileName) === tsconfigPath);
  if (!project) { api.close(); throw new ConfigError(`TypeScript could not load project: ${config.tsconfig}`); }
  const program = project.program;
  const checker = project.checker;
  const wrappers = new Set(config.fetchWrappers ?? []);
  const sends: SendSet[] = [];
  for (const fileName of files) {
    const source = program.getSourceFile(fileName);
    if (!source) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isConfiguredCall(node.expression, checker, wrappers)) {
        const callee = rootCalleeName(node.expression, checker);
        if (!(callee?.name === "fetch" && callee.library && isInsideConfiguredWrapper(node, wrappers))) sends.push(...analyzeCall(node, checker, root));
      }
      node.forEachChild(visit);
    };
    visit(source);
  }
  snapshot.dispose();
  api.close();
  return sends.sort((a, b) => a.site.file.localeCompare(b.site.file) || a.site.line - b.site.line);
}
