import { z } from 'zod';
import { placeProfileSchema, type Item, type PlaceProfile } from './domain';
import { profileRules, redact, structured } from './llm';

const outputSchema = z.object({ items: z.array(z.object({ id: z.string(), profile: placeProfileSchema })).max(50) });

/** Read the nature of stops saved without one: added by hand, or saved before profiles existed. */
export async function classifyItems(items: Item[]): Promise<Map<string, PlaceProfile>> {
  const todo = items.filter(i => !i.profile);
  if (!todo.length) return new Map();
  const input = todo.map(i => ({ id: i.id, placeName: i.placeName, kind: i.kind, activity: i.activity, sourceText: redact(i.sourceText).slice(0, 600), claimedRules: i.claimedRules.map(c => c.text).slice(0, 6) }));
  const out = await structured('extract', outputSchema, `你是旅行攻略读取器。根据每项安排的原文判断它的性质，不补充原文没有的信息。\n${profileRules}\n按输入的 id 逐项返回。`, [{ type: 'input_text', text: JSON.stringify(input) }], 6000);
  const ids = new Set(todo.map(i => i.id));
  return new Map(out.items.filter(r => ids.has(r.id)).map(r => [r.id, r.profile]));
}

/** The same trip with every stop profiled. If the model is unavailable the trip is kept as it is. */
export async function withProfiles<T extends { items: Item[] }>(trip: T): Promise<T> {
  try {
    const found = await classifyItems(trip.items);
    return found.size ? { ...trip, items: trip.items.map(i => found.has(i.id) ? { ...i, profile: found.get(i.id) } : i) } : trip;
  } catch { return trip; }
}
