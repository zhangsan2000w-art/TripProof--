import type { Draft, Item } from './domain';
import { AppError } from './errors';

/** Formatting copied from social posts is not part of a place's name. */
export const readableText = (text: string) => text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

/** This controls applicable checks, never establishes opening hours or admission rights. */
export function openArea(item: Pick<Item, 'placeName' | 'kind'>) {
  return ['scenic','other'].includes(item.kind) && /步行街|街区|老街|直街|武康路|安福路|五原路|河坊街|夜市|^(?:外滩|陆家嘴)$/.test(readableText(item.placeName));
}
export function flexibleTransfer(item: Pick<Item,'kind'|'sourceText'|'placeName'>) {
  return item.kind==='transport'&&/步行|打车|自驾|驾车|骑行/.test(readableText(item.sourceText))&&!/公交|巴士|地铁|轨道|轮渡|游船|坐船|乘船|高铁|火车|班车|航班|客运|[sS][12]/.test(`${item.placeName} ${item.sourceText}`);
}

/** Only explicit joins are split; “与/和” can be part of an institution's proper name. */
export function joinedVenues(name: string) {
  const parts = readableText(name).split(/\s*[&＋+]\s*/);
  return parts.length >= 2 && parts.length <= 4 && parts.every(p => /[\u3400-\u9fff]{2}/.test(p) && !/午餐|晚餐|早餐|前往|交通|咖啡|附近/.test(p)) ? parts : [];
}

/** A shared visiting window does not give each independent venue its own arrival time. */
export function prepareDraft(draft: Draft, imageIndices: number[]): Draft {
  const clean = structuredClone(draft);
  for (const day of clean.days) {
    // A map's short connector labels describe the link to the next stop, not another venue or a scheduled service.
    day.items=day.items.filter((item,index,all)=>{
      const note=readableText(item.sourceText).replace(/\s+/g,''),next=all[index+1],previous=all[index-1];
      if(item.kind!=='transport'||item.start||item.end||!previous||!next||previous.kind==='transport'||next.kind==='transport'||!/^(?:步行|打车|自驾|驾车|骑行|步行\+坐船)(?:约?\d+(?:[-~～]\d+)?分钟)?$/.test(note))return true;
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
export function unresolvedTarget(item: Pick<Item, 'kind' | 'placeName' | 'sourceText'>): { code: string; message: string } | null {
  const name = readableText(item.placeName);
  if ((item.kind === 'restaurant' || item.kind === 'hotel') && (/(?:附近|周边|一带|待定|未定)$/.test(name) || /^(?:午餐|晚餐|早餐|用餐|午餐和咖啡|午餐\s*[&+]\s*咖啡|咖啡|住宿|酒店)$/.test(name))) {
    return { code: 'UNSPECIFIED_BUSINESS', message: item.kind === 'restaurant' ? '这是用餐时段，尚未选定餐厅；保留安排，选好具体商家后再核对营业时间。' : '尚未选定具体住宿；保留安排，选定酒店后再核对。' };
  }
  if (item.kind === 'transport' && /步行或(?:乘|坐)?地铁|地铁或(?:步行|打车)|交通方式未定/.test(readableText(item.sourceText))) {
    return { code: 'UNSPECIFIED_ROUTE', message: '原文提供了多种交通方式，尚未选定路线和乘车时间；不能据此确认班次或衔接耗时。' };
  }
  return null;
}
