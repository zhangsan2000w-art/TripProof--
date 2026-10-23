import { z } from 'zod';
import { opSchema, dateString, type Trip, type RunResult, type Evidence } from './domain';

const targets = z.array(z.string()).min(1).max(50);
export const focusSchema = z.enum(['baseline', 'hours', 'reservation', 'closures', 'identity', 'contradiction', 'transport']);
export const agentActionSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('investigate'), itemIds: targets, focus: focusSchema, query: z.string().max(300).nullable() }),
  z.object({ tool: z.literal('read_sources'), itemIds: targets }),
  z.object({ tool: z.literal('evaluate'), itemIds: targets }),
  z.object({ tool: z.literal('check_context') }),
  z.object({ tool: z.literal('preview_repair'), title: z.string().min(1).max(160), ops: z.array(opSchema).max(10), startDate: dateString.nullable() }),
  z.object({ tool: z.literal('find_alternatives'), itemId: z.string(), reason: z.string().max(300) }),
  z.object({ tool: z.literal('ask_user'), itemIds: targets, question: z.string().min(1).max(600) }),
  z.object({ tool: z.literal('answer'), text: z.string().min(1).max(3000), evidenceIds: z.array(z.string()).max(20) }),
  z.object({ tool: z.literal('finish') }),
]);
export const decisionSchema = z.object({ summary: z.string().min(1).max(240), actions: z.array(agentActionSchema).min(1).max(6) });
export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentDecision = z.infer<typeof decisionSchema>;
export type AgentFocus = z.infer<typeof focusSchema>;
export type AgentMessage = { id: string; tripId: string; runId: string | null; role: 'user' | 'assistant'; text: string; evidenceIds: string[]; at: string; requestId?: string; questionId?: string; revision?: number };
export type AgentQuestion = { id: string; text: string; itemIds: string[]; answered: boolean };
export type AgentCheck = { itemId: string; place: string; status: 'pending' | 'searching' | 'reading' | 'done' | 'needs_input'; missing: string[]; searchedScope: string[]; nextAction: string | null; stopReason: string | null; noProgress: number };
export type AgentStep = { id: string; round: number; action: AgentAction; status: 'running' | 'completed' | 'failed'; at: string; elapsedMs: number; detail: string };
export type AgentProposal = { id: string; tripId: string; runId: string; revision: number; basisHash: string; title: string; ops: z.infer<typeof opSchema>[]; startDate?: string; trip: Trip; result: RunResult; at: string };
export type AgentCheckpoint = { version: 1; runId: string; revision: number; round: number; elapsedMs: number; checks: AgentCheck[]; questions: AgentQuestion[]; steps: AgentStep[]; pending: AgentAction[]; sources: Record<string, Evidence[]>; parsed: Record<string, string[]>; processedMessages: string[]; contextDone: boolean; alternativesDone: string[]; stopped: boolean; explanationOnly: boolean; deadlineReached?: boolean; deferQuestions?: boolean; quotaReserved?: boolean };
export type AgentView = Pick<AgentCheckpoint, 'round' | 'elapsedMs' | 'checks' | 'questions' | 'steps'> & { messages: AgentMessage[]; proposals: Pick<AgentProposal, 'id' | 'title' | 'at'>[]; contextDone: boolean };
export const messageInputSchema = z.object({ requestId: z.uuid(), revision: z.number().int().positive(), text: z.string().trim().min(1).max(4000), replyTo: z.string().optional() });
