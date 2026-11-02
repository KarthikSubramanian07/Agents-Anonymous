/**
 * MeetingStore: the Meeting's SQLite database, living in a Durable Object.
 * It runs the same SQL the API was written against (the files in ../migrations),
 * so the Functions talk to it through a tiny D1-shaped adapter (src/server/db.ts).
 */
import { DurableObject } from "cloudflare:workers";
import init from "../migrations/0001_init.sql";
import seed from "../migrations/0002_seed.sql";
import scores from "../migrations/0003_scores.sql";

const MIGRATIONS: [string, string][] = [
  ["0001_init", init],
  ["0002_seed", seed],
  ["0003_scores", scores],
];

export interface Row {
  [column: string]: unknown;
}
export interface Result {
  rows: Row[];
  changes: number;
}

export class MeetingStore extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    const done = new Set(sql.exec<{ name: string }>("SELECT name FROM _migrations").toArray().map((r) => r.name));
    for (const [name, body] of MIGRATIONS) {
      if (done.has(name)) continue;
      this.ctx.storage.transactionSync(() => {
        sql.exec(body);
        sql.exec("INSERT INTO _migrations (name, applied_at) VALUES (?, unixepoch())", name);
      });
    }
  }

  /** Run one statement. */
  async query(statement: string, params: unknown[] = []): Promise<Result> {
    const cursor = this.ctx.storage.sql.exec(statement, ...(params as SqlStorageValue[]));
    const rows = cursor.toArray() as Row[];
    return { rows, changes: cursor.rowsWritten };
  }

  /** Run several statements atomically. */
  async batch(statements: { sql: string; params: unknown[] }[]): Promise<Result[]> {
    return this.ctx.storage.transactionSync(() =>
      statements.map(({ sql, params }) => {
        const cursor = this.ctx.storage.sql.exec(sql, ...(params as SqlStorageValue[]));
        const rows = cursor.toArray() as Row[];
        return { rows, changes: cursor.rowsWritten };
      })
    );
  }
}

export default {
  fetch: () => new Response("Nothing to see here. The meeting is upstairs.", { status: 404 }),
};
