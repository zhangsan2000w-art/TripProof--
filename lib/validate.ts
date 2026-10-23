import { tripInputSchema, type TripInput } from './domain';
import { validDate, tomorrow } from './dates';
import { AppError } from './errors';
import { redactValues } from './llm';
export function validateTrip(value: unknown): TripInput {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const trip = tripInputSchema.parse(input && (input.startDate === undefined || input.startDate === null || input.startDate === '') ? { ...input, startDate: tomorrow() } : value);
  if (!validDate(trip.startDate) || (trip.guidePublishedAt && !validDate(trip.guidePublishedAt))) throw new AppError('INVALID_DATE', '请输入有效的日期。');
  const ids = new Set(trip.items.map(i => i.id));
  if (ids.size !== trip.items.length) throw new AppError('DUPLICATE_ITEM', '行程项编号不能重复。');
  for (const item of trip.items) {
    if (!item.placeName.trim() || !item.sourceText.trim()) throw new AppError('MISSING_PLACE', '请填写地点名称与原始资料。');
    if (item.dependsOn.some(dep => !ids.has(dep) || dep === item.id)) throw new AppError('INVALID_DEPENDENCY', '依赖项必须指向其他已存在的行程项。');
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(itemId: string) {
    if (visiting.has(itemId)) throw new AppError('CYCLIC_DEPENDENCY', '行程依赖不能形成循环。');
    if (visited.has(itemId)) return;
    visiting.add(itemId); for (const dep of trip.items.find(i => i.id === itemId)!.dependsOn) visit(dep); visiting.delete(itemId); visited.add(itemId);
  }
  for (const item of trip.items) visit(item.id);
  return tripInputSchema.parse(redactValues(trip));
}
