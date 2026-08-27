export type Site = { file: string; line: number };
export type UnresolvedDetail = { message: string; site: Site };
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
};

export interface ServerAdapter {
  name: string;
  extract(config: unknown, configDirectory?: string): Promise<ReadSet[]>;
}

export type ReaderShape = { call: string; nameArg: number };

export type ClientConfig = {
  tsconfig: string;
  include?: string[];
  fetchWrappers?: string[];
};

export type ServerConfig = {
  adapter: string;
  root: string;
  readerShapes?: ReaderShape[];
  routeOverrides?: Record<string, string>;
};

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
  rules: RulesConfig;
  allow: AllowEntry[];
};

export type Finding =
  | { kind: "unmatched"; method: string; route: string; location: FieldLocation; field: string; direction: "sent-not-read" | "read-not-sent"; source: Site; counterpart: Site; sources?: Site[]; counterparts?: Site[] }
  | { kind: "unresolved"; message: string; site: Site }
  | { kind: "unmapped"; method: string; route: string; site: Site; error: boolean };

export type CheckResult = {
  schemaVersion: 1;
  sends: SendSet[];
  reads: ReadSet[];
  findings: Finding[];
  summary: { unmatched: number; unresolved: number; unmapped: number };
  exitCode: 0 | 1 | 3;
};
