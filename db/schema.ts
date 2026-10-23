import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import type { Trip, Run, RunResult, RunEvent, EventType, Item } from '@/lib/domain';
export const trips = sqliteTable('trips', {
  id: text('id').primaryKey(), shareId: text('share_id').notNull().unique(), owner: text('owner').notNull(),
  body: text('body', { mode: 'json' }).$type<Trip>().notNull(), updatedAt: text('updated_at').notNull(),
});
export const items = sqliteTable('items', { id: text('id').primaryKey(), tripId: text('trip_id').notNull(), payload: text('payload', { mode: 'json' }).$type<Item>().notNull() });
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(), tripId: text('trip_id').notNull(), kind: text('kind').$type<Run['kind']>().notNull(),
  status: text('status').$type<Run['status']>().notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
  startedAt: text('started_at'), completedAt: text('completed_at'), firstVerdictAt: text('first_verdict_at'),
  used: integer('used').notNull().default(0), limit: integer('budget_limit').notNull().default(40),
  input: text('input', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  result: text('result', { mode: 'json' }).$type<RunResult>(), error: text('error'), tripRevision: integer('trip_revision').notNull(),
}, t => [index('runs_queue').on(t.status, t.createdAt)]);
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }), runId: text('run_id').notNull(),
  type: text('type').$type<EventType>().notNull(), data: text('data', { mode: 'json' }).$type<RunEvent['data']>().notNull(), at: text('at').notNull(),
}, t => [index('events_run').on(t.runId, t.id)]);
function entity(name: string) { return sqliteTable(name, { id: text('id').notNull(), runId: text('run_id').notNull(), payload: text('payload', { mode: 'json' }).$type<unknown>().notNull() }, t => [primaryKey({ columns: [t.runId, t.id] })]); }
export const venues = entity('venues'); export const searchCalls = entity('search_calls');
export const evidence = entity('evidence'); export const facts = entity('facts'); export const judgments = entity('judgments');
export const ripples = entity('ripples'); export const suggestions = entity('suggestions');
export const cache = sqliteTable('cache', { key: text('key').primaryKey(), payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(), expiresAt: integer('expires_at').notNull() });
export const feedback = sqliteTable('feedback', { judgmentId: text('judgment_id').notNull(), session: text('session').notNull(), vote: integer('vote').notNull(), at: text('at').notNull() }, t => [primaryKey({ columns: [t.judgmentId, t.session] })]);
export const usage = sqliteTable('usage', { key: text('key').primaryKey(), count: integer('count').notNull().default(0) });
export const accessAttempts = sqliteTable('access_attempts', { key: text('key').primaryKey(), failures: integer('failures').notNull().default(0), expiresAt: integer('expires_at').notNull() });
