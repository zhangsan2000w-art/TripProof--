import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/db';
import type { AgentCheckpoint, AgentMessage, AgentProposal, AgentView } from './agent-types';
import type { Evidence, RunResult } from './domain';
import { AppError } from './errors';

export function checkpoint(runId: string): AgentCheckpoint | null {
  const row = database().sqlite.prepare('SELECT payload FROM agent_checkpoints WHERE run_id=?').get(runId) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : null;
}
export function saveCheckpoint(state: AgentCheckpoint) {
  database().sqlite.prepare('INSERT INTO agent_checkpoints(run_id,payload) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET payload=excluded.payload').run(state.runId, JSON.stringify(state));
}
export function messages(tripId: string): AgentMessage[] {
  return (database().sqlite.prepare('SELECT payload FROM agent_messages WHERE trip_id=? ORDER BY rowid').all(tripId) as { payload: string }[]).map(r => JSON.parse(r.payload));
}
export function messageByRequest(tripId: string, requestId: string): AgentMessage | null {
  const row = database().sqlite.prepare('SELECT payload FROM agent_messages WHERE trip_id=? AND request_id=?').get(tripId, requestId) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : null;
}
export function addMessage(input: Omit<AgentMessage, 'id' | 'at'>): AgentMessage {
  if (input.requestId) { const old = messageByRequest(input.tripId, input.requestId); if (old) return old; }
  const message = { ...input, id: randomUUID(), at: new Date().toISOString() };
  database().sqlite.prepare('INSERT INTO agent_messages(id,trip_id,run_id,request_id,payload) VALUES(?,?,?,?,?)').run(message.id, message.tripId, message.runId, message.requestId ?? null, JSON.stringify(message));
  return message;
}
export function resultFingerprint(result: RunResult): string {
  const rows = result.dossiers.map(d => ({
    venue: d.venue,
    places: d.places,
    facts: [...d.facts].sort((a,b) => a.id.localeCompare(b.id)),
    evidence: d.evidence.map(e => [e.id, e.pageSha256, e.linkStatus, e.linkCheckedAt, e.tier]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))),
  })).sort((a,b) => a.venue.id.localeCompare(b.venue.id));
  return createHash('sha256').update(JSON.stringify({ rows, alternatives: result.alternatives.map(a => [a.itemId, a.name, a.dossier]).sort() })).digest('hex');
}
/** Search snapshots are versioned independently of the later page-read snapshot. */
export function sourceSnapshot(e: Evidence): string {
  return `${e.url}#${createHash('sha256').update(JSON.stringify([e.passage,e.content,e.pageSha256,e.publishedAt])).digest('hex')}`;
}
export function putProposal(proposal: AgentProposal) {
  database().sqlite.prepare('INSERT INTO agent_proposals(id,trip_id,run_id,payload) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(proposal.id, proposal.tripId, proposal.runId, JSON.stringify(proposal));
}
export function getProposal(tripId: string, proposalId: string): AgentProposal {
  const row = database().sqlite.prepare('SELECT payload FROM agent_proposals WHERE id=? AND trip_id=?').get(proposalId, tripId) as { payload: string } | undefined;
  if (!row) throw new AppError('PROPOSAL_NOT_FOUND', '这个预览不存在，请重新生成。', 404);
  return JSON.parse(row.payload);
}
export function agentView(tripId: string, runId: string | null): AgentView | null {
  const state = runId ? checkpoint(runId) : null;
  const chat = messages(tripId);
  if (!state && !chat.length) return null;
  const proposals = runId ? (database().sqlite.prepare('SELECT payload FROM agent_proposals WHERE trip_id=? AND run_id=? ORDER BY rowid DESC LIMIT 3').all(tripId, runId) as { payload: string }[])
    .map(r => JSON.parse(r.payload) as AgentProposal).map(({id,title,at}) => ({id,title,at})).reverse() : [];
  return { round: state?.round ?? 0, elapsedMs: state?.elapsedMs ?? 0, checks: state?.checks ?? [], questions: state?.questions ?? [], steps: state?.steps.slice(-24) ?? [], contextDone: state?.contextDone ?? true, messages: chat, proposals };
}
