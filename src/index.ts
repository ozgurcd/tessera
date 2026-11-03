import { extractClient } from "./client.js";
import { loadConfig } from "./config.js";
import { adapterFor } from "./adapters.js";
import { match } from "./matcher.js";
import type { CheckResult, ReadSet, SendSet, TesseraConfig } from "./types.js";

export * from "./types.js";
export { ConfigError, loadConfig } from "./config.js";
export { extractClient } from "./client.js";
export { GoGinAdapter } from "./go-gin.js";
export { GoNetHttpAdapter } from "./go-nethttp.js";
export { match } from "./matcher.js";

export async function extract(config: TesseraConfig, configDirectory = process.cwd()): Promise<{ sends: SendSet[]; reads: ReadSet[] }> {
  const sends = extractClient(config.client, configDirectory);
  const reads = await adapterFor(config.server.adapter).extract(config.server, configDirectory);
  return { sends, reads };
}

export async function check(config: TesseraConfig, configDirectory = process.cwd()): Promise<CheckResult> {
  const { sends, reads } = await extract(config, configDirectory);
  return match(sends, reads, config.rules, config.allow);
}

export async function checkConfig(configPath = "tessera.config.json"): Promise<CheckResult> {
  const loaded = loadConfig(configPath);
  return check(loaded.config, loaded.directory);
}
