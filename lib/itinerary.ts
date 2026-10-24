import type { Draft, Item, PlaceProfile } from './domain';
import { AppError } from './errors';

/** Formatting copied from social posts is not part of a place's name. */
export const readableText = (text: string) => text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

type Profiled = Pick<Item, 'kind'> & { profile?: PlaceProfile };
/**
 * Walking a public area such as a street or waterfront, as the model read it from the guide.
 * This decides which checks apply; it never establishes opening hours or admission rights.
 */
export function openArea(item: Profiled) {
  return !!item.profile?.openArea && ['scenic', 'other'].includes(item.kind);
}
/** Ways of travelling with no timetable: the traveller leaves when the visit ends. */
const untimedModes = new Set<PlaceProfile['mode']>(['walk', 'taxi', 'drive', 'bike']);
export function flexibleTransfer(item: Profiled) {
  return item.kind === 'transport' && untimedModes.has(item.profile?.mode ?? null);
}

/** A nested transfer inherits a window, never an invented departure time. */
export function transportWindow(item: Item, items: Item[]) {
  if (item.kind !== 'transport' || item.start) return null;
  const ordered = items.filter(i => i.day === item.day).sort((a,b) => a.seq-b.seq);
  const at = ordered.findIndex(i => i.id === item.id), next = ordered[at+1];
  const firstSentence = readableText(item.sourceText).split(/[。\n]/)[0].replace(/\s+/g, '');
  if (at < 0 || !next || next.kind === 'transport' || !next.start || !next.end || firstSentence.length < 12) return null;
  const parent = readableText(next.sourceText).replace(/\s+/g, '');
  const times = `${next.start}—${next.end}`;
  // Require the transfer's original sentence AND the parent's times in the same source block.
  const sourceTimes = parent.replace(/(\d{1,2})[:：](\d{2})/g, (_, h:string, m:string) => `${h.padStart(2,'0')}:${m}`);
  if (!parent.includes(firstSentence) || !sourceTimes.includes(next.start) || !sourceTimes.includes(next.end)) return null;
  return { start: next.start, end: next.end, parentId: next.id, label: `${times} 内转场` };
}

export function planTimeLabel(item: Item, items: Item[] = []) {
  return item.start ? `${item.start}${item.end ? `—${item.end}` : ' 到达'}` : transportWindow(item, items)?.label || (flexibleTransfer(item) ? '按游览进度出发' : '时间未单列');
}

/** User text identifies the branch and activity; it never supplies verified opening rules. */
export function placeContext(item: Pick<Item, 'placeName' | 'kind' | 'activity'> & { profile?: PlaceProfile }) {
  const area = openArea(item);
  return { name: item.placeName, kind: item.kind, address: item.profile?.address ?? null, scope: area ? '公共区域漫步；不包含其中需要购票或另有开放时间的场馆和商户' : '指定地点的实际活动', activity: item.activity };
}

/** Only explicit joins are split; “与/和” can be part of an institution's proper name. */
export function joinedVenues(name: string) {
  const parts = readableText(name).split(/\s*[&＋+]\s*/);
  return parts.length >= 2 && parts.length <= 4 && parts.every(p => /[\u3400-\u9fff]{2}/.test(p)) ? parts : [];
}

/** A shared visiting window does not give each independent venue its own arrival time. */
export function prepareDraft(draft: Draft, imageIndices: number[]): Draft {
  const clean = structuredClone(draft);
  for (const day of clean.days) {
    // An untimed walk or ride between two stops describes how to reach the next one; it is not a scheduled service.
    day.items=day.items.filter((item,index,all)=>{
      const next=all[index+1],previous=all[index-1];
      if(!flexibleTransfer(item)||item.start||item.end||!previous||!next||previous.kind==='transport'||next.kind==='transport')return true;
      const text=`${previous.placeName} → ${next.placeName}：${item.sourceText}`;
      if(!next.claimedRules.some(c=>c.kind==='transport'&&c.text===text))next.claimedRules.push({kind:'transport',text});
      return false;
    });
    day.items = day.items.filter(i => i.sourceText.trim()).flatMap(item => {
      const names = ['museum', 'scenic', 'show'].includes(item.kind) ? joinedVenues(item.placeName) : [];
      const base = { ...item, sourceImage: item.sourceImage && imageIndices.includes(item.sourceImage) ? item.sourceImage : null };
      if (!names.length) return [base];
      const window = item.start ? `${item.start}${item.end ? `—${item.end}` : ''}` : null;
      const note = `${names.join('、')}分别核对${window ? `；原文 ${window} 是联合游览时段，未注明各处单独的到达时间` : ''}。`;
      clean.ambiguities.push(note);
      return names.map((name, index) => ({
        ...base, placeName: name, start: null, end: null,
        activity: `${window ? `原文联合时段 ${window}；本站时间未单列。` : ''}${item.activity}`.slice(0, 300),
        dependsOnPrevious: index === 0 && item.dependsOnPrevious,
        // Shared claims remain in sourceText; do not give one venue another's ticket rule.
        claimedRules: item.claimedRules.filter(c => c.text.includes(name) && !names.some(other => other !== name && c.text.includes(other))),
      }));
    }).map((item, index) => ({ ...item, seq: index + 1 }));
  }
  clean.days = clean.days.filter(d => d.items.length);
  if (clean.days.some(d => d.items.length > 40) || clean.days.reduce((n, d) => n + d.items.length, 0) > 50) {
    throw new AppError('ITINERARY_TOO_LARGE', '攻略中的独立安排较多，一次最多核对50项、每天最多40项。请按日期分开读取。', 422);
  }
  const notes = [...new Set(clean.ambiguities)];
  clean.ambiguities = notes.length <= 40 ? notes : [...notes.slice(0, 39), `另有${notes.length - 39}条校对提示，请逐项对照原文和活动说明。`];
  return clean;
}

export function missingTimeNote(item: Pick<Item, 'activity'>) {
  return /联合时段/.test(item.activity) ? '原文是联合时段，本站时间未单列' : '原文没写到达时间';
}

/** Retain these schedule blocks without inventing a business or a selected transport line. */
export function unresolvedTarget(item: Profiled): { code: string; message: string } | null {
  // A street walk is itself the destination, and a walk or taxi ride has no timetable,
  // so a shop or drop-off not yet chosen leaves nothing to check.
  if (!item.profile?.undecided || openArea(item) || flexibleTransfer(item)) return null;
  if (item.kind === 'restaurant') return { code: 'UNSPECIFIED_BUSINESS', message: '这是用餐时段，尚未选定餐厅；保留安排，选好具体商家后再核对营业时间。' };
  if (item.kind === 'hotel') return { code: 'UNSPECIFIED_BUSINESS', message: '尚未选定具体住宿；保留安排，选定酒店后再核对。' };
  if (item.kind === 'transport') return { code: 'UNSPECIFIED_ROUTE', message: '原文提供了多种交通方式，尚未选定路线和乘车时间；不能据此确认班次或衔接耗时。' };
  return { code: 'UNSPECIFIED_PLACE', message: '攻略还没选定具体地点；选好后再核对开放规则。' };
}
