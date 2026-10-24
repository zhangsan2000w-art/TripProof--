import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

function connect() {
  // The database is a runtime volume, never an input to Next's file tracing.
  const path = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || '.data/tripproof.db');
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL'); sqlite.pragma('busy_timeout = 10000'); sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, share_id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, first_verdict_at TEXT, used INTEGER NOT NULL DEFAULT 0, budget_limit INTEGER NOT NULL DEFAULT 40, input TEXT NOT NULL, result TEXT, error TEXT, trip_revision INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS runs_queue ON runs(status, created_at);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_run ON events(run_id, id);
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback (judgment_id TEXT NOT NULL, session TEXT NOT NULL, vote INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY(judgment_id, session));
    CREATE TABLE IF NOT EXISTS usage (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS access_attempts (key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS guides (trip_id TEXT PRIMARY KEY, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS guide_images (trip_id TEXT NOT NULL, idx INTEGER NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(trip_id, idx));
    CREATE TABLE IF NOT EXISTS agent_checkpoints (run_id TEXT PRIMARY KEY REFERENCES runs(id), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), run_id TEXT, request_id TEXT, payload TEXT NOT NULL, UNIQUE(trip_id, request_id));
    CREATE INDEX IF NOT EXISTS agent_messages_trip ON agent_messages(trip_id);
    CREATE TABLE IF NOT EXISTS agent_proposals (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), run_id TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS venue_usage (run_id TEXT NOT NULL, venue_id TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(run_id,venue_id));
  `);
  for (const name of ['venues', 'search_calls', 'evidence', 'facts', 'judgments', 'ripples', 'suggestions']) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT NOT NULL, run_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,id))`);
  }
  sqlite.exec("CREATE INDEX IF NOT EXISTS search_calls_venue ON search_calls(run_id,json_extract(payload,'$.venueId'))");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
const globalDB = globalThis as unknown as { tripproofDB?: ReturnType<typeof connect> };
export function database() { return globalDB.tripproofDB ??= connect(); }
