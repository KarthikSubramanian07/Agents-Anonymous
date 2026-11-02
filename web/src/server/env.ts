/// <reference types="@cloudflare/workers-types" />
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Salt for hashing IPs and tokens. Set as a Pages secret in production. */
  HASH_SALT?: string;
}
export type Ctx = EventContext<Env, string, Record<string, unknown>>;
