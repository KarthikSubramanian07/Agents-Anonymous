/// <reference types="@cloudflare/workers-types" />
export interface Env {
  /** The Meeting's SQLite store (a Durable Object in the agents-anonymous-store Worker). */
  MEETING: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** Salt for hashing IPs and tokens. Set as a Pages secret in production. */
  HASH_SALT?: string;
}
export type Ctx = EventContext<Env, string, Record<string, unknown>>;
