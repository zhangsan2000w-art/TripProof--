import { randomUUID } from 'node:crypto';
import type { TripInput, Item, Judgment, Dossier, Operation, Ripple, Suggestion, Alternative } from './domain';
import { judgeTrip, summary } from './judge';
import { minutes, formatMinutes, dateForDay, inSeason } from './dates';
import { AppError } from './errors';

export function rippleEffects(trip: TripInput, judgments: Judgment[]): Ripple[] {
  const out: Ripple[] = [], sorted = [...trip.items].sort((a, b) => a.day - b.day || a.seq - b.seq);
  const causes = new Set(judgments.filter(j => j.verdict === 'conflict' && j.type !== 'guide_claim').map(j => j.itemId));
  for (const item of sorted.filter(i => causes.has(i.id))) {
    const day = sorted.filter(i => i.day === item.day), index = day.indexOf(item), after = day.slice(index + 1);
    const add = (target: Item, kind: Ripple['kind'], reason: string) => { if (!out.some(r => r.itemId === target.id && r.causeItemId === item.id)) out.push({ itemId: target.id, causeItemId: item.id, kind, reason }); };
    for (const next of sorted.filter(i => i.id !== item.id && i.dependsOn.includes(item.id))) add(next, 'EXPLICIT', `这项活动明确依赖「${item.placeName}」。`);
    if (after[0]) add(after[0], 'LEG_ORIGIN_CHANGED', `「${item.placeName}」需要调整，前往下一站的出发位置或顺序需重新确认。`);
    for (const next of after) {
      if (next.dependsOn.includes(item.id)) add(next, 'EXPLICIT', `这项活动明确依赖「${item.placeName}」。`);
      else if (next.placeName === item.placeName || (next.activity.includes(item.placeName) && /内|里面|餐|咖啡/.test(next.activity))) add(next, 'SAME_VENUE', `这项活动位于「${item.placeName}」内，需要重新确认。`);
      else {
        const previous = day[day.indexOf(next) - 1];
        if (previous?.end && next.start && minutes(next.start) - minutes(previous.end) >= 0 && minutes(next.start) - minutes(previous.end) < 30) add(next, 'TIMING_CHAIN', '与前一项相隔不足30分钟，调整后的时间衔接需重新确认。');
      }
    }
  }
  return out;
}
export function applyOperations(trip: TripInput, ops: Operation[], alternatives: Alternative[] = []): TripInput {
  const copy = structuredClone(trip);
  for (const op of ops) {
    const item = copy.items.find(i => i.id === op.itemId);
    if (!item) throw new AppError('INVALID_OPERATION', '修改目标已不在行程中，请刷新后重试。');
    if (op.type === 'replace') {
      const candidate = alternatives.find(a => a.itemId === item.id && a.dossier.venue.id === op.alternativeId);
      if (!candidate || candidate.dossier.venue.city.replace(/市$/,'') !== (item.city || trip.destinationCity).replace(/市$/,'')) throw new AppError('INVALID_ALTERNATIVE','替代场馆必须来自这项安排已保存的同城候选。');
      item.placeName = candidate.name; item.city = candidate.dossier.venue.city; item.proposedBy = 'agent';
      item.activity = `Agent 建议：以${candidate.name}替代原安排`;
      item.sourceText = `Agent 建议替代场馆：${candidate.name}。原安排：${item.sourceText}`.slice(0,1500);
      item.sourceImage = null; item.claimedRules = [];
    }
    if (op.type === 'drop') { copy.items = copy.items.filter(i => i.id !== item.id).map(i => ({ ...i, dependsOn: i.dependsOn.filter(id => id !== item.id) })); }
    if (op.type === 'shift') { item.start = op.start; item.end = op.end; }
    if (op.type === 'swap') {
      const other = copy.items.find(i => i.id === op.otherItemId);
      if (!other || other.id === item.id) throw new AppError('INVALID_OPERATION', '交换的两个行程项必须存在且不同。');
      const slot = { day: item.day, seq: item.seq, start: item.start, end: item.end };
      Object.assign(item, { day: other.day, seq: other.seq, start: other.start, end: other.end }); Object.assign(other, slot);
    }
  }
  copy.items.sort((a, b) => a.day - b.day || a.seq - b.seq);
  for (const day of new Set(copy.items.map(i => i.day))) copy.items.filter(i => i.day === day).forEach((i, n) => { i.seq = n + 1; });
  if (!copy.items.length) throw new AppError('EMPTY_TRIP', '不能删除全部行程；请先添加一个安排。');
  return copy;
}
function overlaps(items: Item[]) {
  return items.some((a, n) => items.slice(n + 1).some(b => a.day === b.day && a.start && a.end && b.start && b.end && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end)));
}
export function suggestions(trip: TripInput, dossiers: Dossier[], before = judgeTrip(trip, dossiers)): Suggestion[] {
  const total = before.filter(j => j.verdict === 'conflict' && j.type !== 'guide_claim' && j.type !== 'weather').length, initialUnknowns = summary(before).unknown;
  if (!total) return [];
  const conflicting = trip.items.filter(i => before.some(j => j.itemId === i.id && j.verdict === 'conflict' && j.type !== 'guide_claim'));
  const out: Suggestion[] = [];
  const consider = (ops: Operation[], title: string, cost: number) => {
    let next: TripInput;
    try { next = applyOperations(trip, ops); } catch { return; }
    if (overlaps(next.items)) return;
    const judgments = judgeTrip(next, dossiers), stats = summary(judgments.filter(j => j.type !== 'guide_claim' && j.type !== 'weather'));
    if (stats.conflict >= total) return;
    out.push({ id: randomUUID(), title, ops, cost, conflictsBefore: total, conflictsAfter: stats.conflict, unknownsAfter: stats.unknown, judgments, itemsAfter: next.items,
      warning: stats.conflict ? `仍有${stats.conflict}项冲突，需要继续处理。` : stats.unknown > initialUnknowns ? '调整后新增待确认项；没有额外联网查询。' : '只使用已存事实复核；实时库存、交通耗时和未给出的时间仍需确认。' });
  };
  for (const item of conflicting) {
    const date = dateForDay(trip.startDate, item.day);
    const dossier = dossiers.find(d => d.venue.key === `${item.city || trip.destinationCity}:${item.placeName}`);
    if (item.start && dossier) for (const fact of dossier.facts) {
      const periods = fact.kind === 'hours' ? fact.payload.seasons.filter(s => inSeason(date, s.from, s.to)) : fact.kind === 'temp_hours' && fact.payload.from <= date && fact.payload.to >= date ? [fact.payload] : [];
      for (const p of periods) {
        const duration = item.end ? minutes(item.end) - minutes(item.start) : 0;
        for (const m of [minutes(p.open), minutes(p.open) + 30, (p.lastEntry ? minutes(p.lastEntry) : minutes(p.close)) - Math.max(60, duration)]) {
          if (m < 0 || m >= 1440 || m + duration >= 1440 || duration < 0) continue;
          const start = formatMinutes(m), end = item.end ? formatMinutes(m + duration) : null;
          consider([{ type: 'shift', itemId: item.id, start, end }], `将「${item.placeName}」调整至 ${start}`, 1 + Math.abs(m - minutes(item.start)) / 240);
        }
      }
    }
    for (const other of trip.items.filter(i => i.day !== item.day && !i.dependsOn.includes(item.id) && !item.dependsOn.includes(i.id))) consider([{ type: 'swap', itemId: item.id, otherItemId: other.id }], `交换「${item.placeName}」与「${other.placeName}」`, 2 + Math.abs(other.day - item.day));
    if (trip.items.length > 1) consider([{ type: 'drop', itemId: item.id }], `移除「${item.placeName}」，保留其余安排`, 100);
  }
  if (conflicting.length > 1 && conflicting.length < trip.items.length) consider(conflicting.map(i => ({ type: 'drop', itemId: i.id })), '移除冲突安排，保留其余路线', 100 * conflicting.length);
  const seen = new Set<string>();
  return out.sort((a, b) => a.conflictsAfter - b.conflictsAfter || a.cost - b.cost || a.unknownsAfter - b.unknownsAfter).filter(s => { const key = JSON.stringify(s.ops); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
}
