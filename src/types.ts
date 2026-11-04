export type Site = { file: string; line: number };
export type UnresolvedDetail = { message: string; site: Site };
/** ReadSet.method for a net/http pattern registered without a method. */
export const ANY_METHOD = "*";
/** Route of a registration whose pattern could not be resolved; its unresolved details are always reported. */
export const UNRESOLVED_ROUTE = "<unresolved>";
export type FieldLocation = "query" | "body";

export type SendSet = {
  method: string;
  route: string;
  query: string[];
  body: string[];
  unresolved: string[];
  site: Site;
};

export type ReadSet = {
  method: string;
  route: string;
  query: string[];
  body: string[];
  unresolved: string[];
  /** Exact provenance for adapter findings; `unresolved` remains for JSON v1 compatibility. */
  unresolvedDetails?: UnresolvedDetail[];
  site: Site;
  /** All handler sites represented by this endpoint; `site` remains for JSON v1 compatibility. */
  sites?: Site[];
  /** The adapter found the route but does not model handler fields; sent fields are reported as unresolved, never as unmatched. */
  fieldsUnmodeled?: boolean;
  /** A net/http `/dir/` or `{rest...}` registration: it serves the route and everything below it. */
  subtree?: boolean;
};

export interface ServerAdapter {
  name: string;
  extract(config: unknown, configDirectory?: string): Promise<ReadSet[]>;
}

export type ReaderShape = { call: string; nameArg: number };

/** A fetch wrapper whose route is not its first argument; `optionsArg` defaults to `routeArg + 1`. */
export type FetchWrapper = { name: string; routeArg: number; optionsArg?: number };

export type ClientConfig = {
  tsconfig: string;
  include?: string[];
  /** A bare name means the route is argument 0 and the request options are argument 1. */
  fetchWrappers?: Array<string | FetchWrapper>;
  /** Path prefixes removed from client routes (for example a UI proxy mount) before pairing. */
  routePrefixStrip?: string[];
};

export type ServerConfig = {
  adapter: string;
  root: string;
  readerShapes?: ReaderShape[];
  /** Calls that take the Gin context and a string but never read a query field; an entry may end in `*`. */
  nonReaders?: string[];
  routeOverrides?: Record<string, string>;
  /** Prepended to every route this root serves (a gateway mount, for example). */
  prefix?: string;
  /** net/http: how many nested `http.StripPrefix` sub-mux mounts are followed. */
  maxMountDepth?: number;
  /**
   * Directories under `root` that are not part of the server: a bare name matches at any depth, a path with a
   * slash is relative to `root`. Default `DEFAULT_SERVER_EXCLUDE`; setting it replaces the default.
   */
  exclude?: string[];
};

/** Directories scanned by no server adapter unless `server.exclude` says otherwise: they hold example, tool and test mains, not the server. */
export const DEFAULT_SERVER_EXCLUDE: readonly string[] = ["examples", "testdata", "tools"];

export type RulesConfig = {
  unmapped: "skip" | "error";
  unresolved: "warn" | "error";
  reverseDirection: boolean;
};

export type AllowEntry = {
  method: string;
  route: string;
  location: FieldLocation;
  field: string;
  reason: string;
};

export type TesseraConfig = {
  client: ClientConfig;
  server: ServerConfig;
  /** Further server roots whose endpoints are paired with the same client. */
  extraServers?: ServerConfig[];
  rules: RulesConfig;
  allow: AllowEntry[];
};

export type Finding =
  | { kind: "unmatched"; method: string; route: string; location: FieldLocation; field: string; direction: "sent-not-read" | "read-not-sent"; source: Site; counterpart: Site; sources?: Site[]; counterparts?: Site[] }
  | { kind: "unresolved"; message: string; site: Site }
  | { kind: "unmapped"; method: string; route: string; site: Site; error: boolean }
  /** A client call served by no specific route, only by a registered subtree (`/dir/` or `{rest...}`) catch-all. Its fields are not checked. */
  | { kind: "catch-all"; method: string; route: string; site: Site; via: { method: string; route: string; site: Site } };

export type CheckResult = {
  schemaVersion: 1;
  sends: SendSet[];
  reads: ReadSet[];
  findings: Finding[];
  summary: { unmatched: number; unresolved: number; unmapped: number; catchAll: number };
  exitCode: 0 | 1 | 3;
};
