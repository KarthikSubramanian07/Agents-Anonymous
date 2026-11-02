/**
 * A D1-shaped handle over the MeetingStore Durable Object, so the rest of the server code
 * reads like ordinary D1: db(env).prepare(sql).bind(...).first() / .all() / .run(), db(env).batch([...]).
 */
import type { Env } from "./env";

interface Result {
  rows: Record<string, unknown>[];
  changes: number;
}
interface StoreStub {
  query(sql: string, params: unknown[]): Promise<Result>;
  batch(statements: { sql: string; params: unknown[] }[]): Promise<Result[]>;
}

class Statement {
  constructor(private stub: StoreStub, readonly sql: string, readonly params: unknown[] = []) {}
  bind(...params: unknown[]) {
    return new Statement(this.stub, this.sql, params);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const r = await this.stub.query(this.sql, this.params);
    return (r.rows[0] as T) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const r = await this.stub.query(this.sql, this.params);
    return { results: r.rows as T[] };
  }
  async run(): Promise<{ meta: { changes: number } }> {
    const r = await this.stub.query(this.sql, this.params);
    return { meta: { changes: r.changes } };
  }
}

export class MeetingDb {
  constructor(private stub: StoreStub) {}
  prepare(sql: string) {
    return new Statement(this.stub, sql);
  }
  async batch(statements: Statement[]) {
    const out = await this.stub.batch(statements.map((s) => ({ sql: s.sql, params: s.params })));
    return out.map((r) => ({ results: r.rows, meta: { changes: r.changes } }));
  }
}

export function db(env: Env): MeetingDb {
  const ns = env.MEETING;
  return new MeetingDb(ns.get(ns.idFromName("meeting")) as unknown as StoreStub);
}
