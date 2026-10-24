import { createHash } from 'node:crypto';
import type { AgentCheckpoint, AgentFocus } from './agent-types';
import type { Dossier, Item, Run, RunResult, Trip, Judgment, SearchParams } from './domain';
import { now, dateForDay } from './dates';
import { emit, getRun, getRunProgress, listCalls } from './store';
import { searchSources } from './search';
import { verifyEvidence } from './evidence';
import { extractFacts, supportedDossierFacts } from './facts';
import { searchName, selectVenueSources } from './source-selection';
import { openArea, unresolvedTarget, flexibleTransfer, placeContext } from './itinerary';
import { judgeTrip } from './judge';
import { rippleEffects, suggestions } from './impact';
import { redact } from './llm';
import { mapLimit, concurrencySetting } from './concurrency';
import { links, models, investigateWeather, searchRisk, readRisk, investigateAlternatives } from './investigate';
import { riskKey } from './risk';
import { assertRunning } from './run-control';
import { AppError, errorMessage } from './errors';
import { sourceSnapshot } from './agent-store';

export type ToolContext = { run: Run; trip: Trip; state: AgentCheckpoint; result: RunResult; persist: (immediate?: boolean) => void };
const published=new WeakMap<ToolContext,Map<string,string>>();
export function dossierFor(ctx: ToolContext, item: Item): Dossier {
  const city=item.city||ctx.trip.destinationCity,key=`${city}:${item.placeName}`;
  const old=ctx.result.dossiers.find(d=>d.venue.key===key); if(old)return old;
  const dates=[...new Set(ctx.trip.items.filter(i=>(i.city||ctx.trip.destinationCity)===city&&i.placeName===item.placeName).map(i=>dateForDay(ctx.trip.startDate,i.day)))];
  const d:Dossier={venue:{id:createHash('sha256').update(key).digest('hex').slice(0,24),key,city,canonicalName:item.placeName,officialDomain:null,officialEvidenceId:null,investigationDates:dates},facts:[],evidence:[],calls:[],searchedScope:[],limitations:[],createdAt:now()};
  ctx.result.dossiers.push(d);return d;
}
export function evaluate(ctx: ToolContext) {
  const comparable=(j:Judgment)=>{const{judgedAt,...rest}=j;void judgedAt;return JSON.stringify(rest);};
  const old=new Map(ctx.result.judgments.map(j=>[`${j.itemId}:${j.type}`,comparable(j)]));
  ctx.result.judgments=judgeTrip(ctx.trip,ctx.result.dossiers);
  ctx.result.ripples=rippleEffects(ctx.trip,ctx.result.judgments);
  ctx.result.suggestions=suggestions(ctx.trip,ctx.result.dossiers,ctx.result.judgments);
  ctx.result.limitations=[...new Set([...ctx.result.limitations,...ctx.result.dossiers.flatMap(d=>d.limitations)])];
  for(const check of ctx.state.checks){
    const item=ctx.trip.items.find(i=>i.id===check.itemId)!;
    const d=ctx.result.dossiers.find(d=>d.venue.key===`${item.city||ctx.trip.destinationCity}:${item.placeName}`);
    const js=ctx.result.judgments.filter(j=>j.itemId===item.id);
    check.missing=[...new Set(js.filter(j=>j.verdict==='unknown'&&!['availability','weather','safety','connection_fit','arrival_fit'].includes(j.type)).map(j=>`${j.type}:${j.reasonCode}`))];
    check.searchedScope=d?.searchedScope??[];
    if(unresolvedTarget(item)){check.status='needs_input';check.stopReason=unresolvedTarget(item)!.message;}
    else if(!['searching','reading'].includes(check.status)&&(check.searchedScope.length||d?.facts.length)){check.status='done';}
  }
  // Facts must be durable before a verdict can count as the first verified result.
  ctx.persist(true);
  const snapshots=published.get(ctx)??new Map<string,string>();published.set(ctx,snapshots);
  for(const d of ctx.result.dossiers){const value=JSON.stringify(d);if(snapshots.get(d.venue.id)!==value){emit(ctx.run.id,'dossier',d);snapshots.set(d.venue.id,value);}}
  for(const j of ctx.result.judgments) if(old.get(`${j.itemId}:${j.type}`)!==comparable(j))emit(ctx.run.id,'verdict',j);
  emit(ctx.run.id,'report_update',{ripples:ctx.result.ripples,suggestions:ctx.result.suggestions,limitations:ctx.result.limitations,alternatives:ctx.result.alternatives,announcement:ctx.result.announcement});
}
export function selectedItems(ctx: ToolContext, ids: string[]) {
  if(ids.some(id=>!ctx.trip.items.some(i=>i.id===id)))throw new AppError('INVALID_TARGET','行动包含不存在的行程项。');
  const seen=new Set<string>();return ctx.trip.items.filter(i=>ids.includes(i.id)).filter(i=>{const k=`${i.city||ctx.trip.destinationCity}:${i.placeName}`;if(seen.has(k))return false;seen.add(k);return true;});
}
const queryWords:Record<Exclude<AgentFocus,'baseline'>,string>={hours:'开放时间 停止入场',reservation:'个人游客 预约 提前 放票 官方',closures:'临时闭馆 恢复开放 公告',identity:'官方网站 主办 参观须知',contradiction:'官方 最新 参观须知 开放 闭馆 预约 公告',transport:'运营时间 首末班 停运 耗时'};
export async function readSources(ctx:ToolContext,ids:string[],onModelReady?:()=>void) {
  await mapLimit(selectedItems(ctx,ids),concurrencySetting('VENUE_CONCURRENCY',6),async item=>{
    assertRunning();const d=dossierFor(ctx,item),check=ctx.state.checks.find(c=>c.itemId===item.id)!;
    const parsed=new Set(ctx.state.parsed[d.venue.key]??[]);
    const pool=ctx.state.sources[d.venue.key]??[];
    const dynamic=new Set(listCalls(ctx.run.id,d.venue.id).filter(c=>c.params.freshness).map(c=>c.id));
    const target=placeContext(item);
    const fresh=selectVenueSources(pool.filter(e=>!parsed.has(sourceSnapshot(e))||(dynamic.has(e.searchCallId)&&!parsed.has(`search:${e.searchCallId}`))),target.name,d.venue.city,d.venue.officialDomain,4,item.kind==='transport');
    if(!fresh.length)return;
    check.status='reading';check.nextAction='逐条核对引文、分馆和数字';ctx.persist();
    const verified=await mapLimit(fresh,4,e=>links.run(()=>verifyEvidence(e,searchName(target.name),dynamic.has(e.searchCallId))));
    assertRunning();
    for(const e of verified){const at=d.evidence.findIndex(old=>old.url===e.url);if(at>=0)d.evidence[at]=e;else d.evidence.push(e);emit(ctx.run.id,'evidence',e);}
    // Replaced/failed pages cannot leave orphaned facts usable while a new parse is pending.
    d.facts=supportedDossierFacts(d);
    ctx.persist();
    let out:Awaited<ReturnType<typeof extractFacts>>;
    onModelReady?.();
    try{out=await models.run(()=>extractFacts(d.venue.id,item.placeName,d.venue.city,d.venue.investigationDates,verified,target));}
    catch(error){assertRunning();d.limitations.push(errorMessage(error));check.status='done';check.stopReason=errorMessage(error);ctx.persist();return;}
    assertRunning();
    d.venue.canonicalName=out.canonicalName;
    if(out.officialDomain){d.venue.officialDomain=out.officialDomain;d.venue.officialEvidenceId=out.officialEvidenceId;}
    const signatures=new Set(d.facts.map(f=>JSON.stringify([f.evidenceId,f.kind,f.payload,f.quote])));
    for(const f of out.facts){const signature=JSON.stringify([f.evidenceId,f.kind,f.payload,f.quote]);if(!signatures.has(signature)){d.facts.push(f);signatures.add(signature);emit(ctx.run.id,'fact',f);}}
    d.facts=supportedDossierFacts(d);d.limitations=[...new Set([...d.limitations,...out.ambiguities])];
    ctx.state.parsed[d.venue.key]=[...new Set([...parsed,...fresh.map(sourceSnapshot),...verified.map(sourceSnapshot),...fresh.map(e=>`search:${e.searchCallId}`)])];
    check.status='done';check.nextAction=null;ctx.persist();
  });
  evaluate(ctx);
}
export async function investigateTargets(ctx:ToolContext,ids:string[],focus:AgentFocus,customQuery:string|null,onFirstVerdict?:()=>void) {
  if(customQuery&&ids.length!==1)throw new AppError('INVALID_QUERY','定向查询一次只能针对一个行程项。');
  const items=selectedItems(ctx,ids).sort((a,b)=>a.day-b.day||a.seq-b.seq);
  const investigate=async(item:Item,onModelReady?:()=>void)=>{
    assertRunning();const d=dossierFor(ctx,item),check=ctx.state.checks.find(c=>c.itemId===item.id)!;
    const unresolved=unresolvedTarget(item);if(unresolved){d.limitations=[unresolved.message];check.status='needs_input';check.stopReason=unresolved.message;ctx.persist();return;}
    if(check.noProgress>=2){check.stopReason='连续两轮未获得新增有效证据，停止补查。';return;}
    const target=placeContext(item),name=redact(searchName(target.name,item.kind==='transport')),city=redact(d.venue.city);
    const address=item.kind==='restaurant'&&target.address?` ${redact(target.address)}`:'';
    const dayItems=ctx.trip.items.filter(i=>i.day===item.day).sort((a,b)=>a.seq-b.seq),previous=dayItems[dayItems.findIndex(i=>i.id===item.id)-1];
    if(focus==='transport'&&item.kind!=='transport'&&!customQuery&&!previous){d.limitations.push('这站没有已选的上一站，未构造交通路线；需补充起点后再核验。');ctx.persist();return;}
    const suffix=item.kind==='transport'?'运营时间 首末班':item.kind==='restaurant'?'营业时间 午市 晚市 订位':openArea(item)?'公共区域 开放时间 步行区域 管理公告':`开放时间 停止入场 参观须知 闭馆${['museum','scenic','show'].includes(item.kind)?' 个人游客 预约 放票':''}`;
    const focusWords=item.kind==='restaurant'&&focus==='hours'?'营业时间 腾讯地图 携程 商户 地址':focus==='hours'&&openArea(item)?'公共区域 开放 管理规定':queryWords[focus==='baseline'?'hours':focus];
    const queries:SearchParams[]=flexibleTransfer(item)?[{query:`${city} ${name} 步行 打车 路线 耗时参考`}]:customQuery?[{query:`${city} ${name}${address} ${redact(customQuery)}`}]:focus==='transport'&&item.kind!=='transport'?[{query:`${city} ${redact(previous!.placeName)} 到 ${name} ${ctx.trip.mode==='drive'?'驾车':'公共交通'} 路线 耗时参考`}]:focus==='baseline'?[{query:`${city} ${name}${address} ${suffix}`},...(item.kind==='restaurant'?[{query:`${city} ${name}${address} 腾讯地图 营业时间`}]:[{query:`${city} ${name} ${item.kind==='transport'?'停运 运营调整':'临时关闭 公告'} ${ctx.trip.startDate.slice(0,7)}`,freshness:'m2'}])]:[{query:`${city} ${name}${address} ${focusWords}`,...(['closures','contradiction'].includes(focus)?{freshness:'m2'}:{}),...(d.venue.officialDomain&&focus!=='contradiction'&&item.kind!=='restaurant'?{site:d.venue.officialDomain}:{})}];
    const validEvidence=()=>new Set(d.facts.filter(f=>f.quoteVerified&&f.linkStatus==='ok').map(f=>`${f.evidenceId}:${f.kind}:${JSON.stringify(f.payload)}`));
    const before=validEvidence();check.status='searching';check.nextAction=focus==='baseline'?'取得规则及近期公告':`补查：${focus}`;ctx.persist();
    const savedCalls=listCalls(ctx.run.id,d.venue.id),counter={used:savedCalls.filter(c=>!c.cacheHit).length};
    await Promise.all(queries.map(async params=>{
      const saved=savedCalls.find(c=>c.query===params.query);
      const attempts=savedCalls.filter(c=>c.query===params.query&&!c.cacheHit).length;
      if(saved&&(!saved.errorCode&&(saved.resultCount===0||(ctx.state.sources[d.venue.key]??[]).some(e=>e.searchCallId===saved.id))||saved.errorCode&&(!/NETWORK|TIMEOUT|ECONN|EAI_AGAIN|SEARCH_HTTP_5/.test(saved.errorCode)||attempts>=2)))return;
      if(!d.searchedScope.includes(params.query))d.searchedScope.push(params.query);ctx.persist();
      try{const response=await searchSources(ctx.run.id,d.venue.id,params,counter);assertRunning();d.limitations.push(...response.limitations);const pool=ctx.state.sources[d.venue.key]??[];ctx.state.sources[d.venue.key]=[...new Map([...pool,...response.pages].map(e=>[e.url,e])).values()];}
      catch(error){assertRunning();d.limitations.push(errorMessage(error));}
      finally{ctx.persist();}
    }));
    d.calls=listCalls(ctx.run.id,d.venue.id);
    await readSources(ctx,[item.id],onModelReady);
    check.status='done';check.nextAction=null;
    check.noProgress=[...validEvidence()].some(key=>!before.has(key))?0:check.noProgress+1;
    if(check.noProgress>=2)check.stopReason='连续两轮未获得新增有效证据，停止补查。';
    if(getRunProgress(ctx.run.id).used>=ctx.run.limit)check.stopReason='搜索预算已用完，未完成的检查保持未知。';
    ctx.persist();
  };
  if(focus==='baseline'&&items.length){
    let release!:()=>void;
    const ready=new Promise<void>(resolve=>{release=resolve;});
    // Give the first stop an uncontended retrieval path, then overlap its model read with other stops.
    const first=investigate(items[0],release).then(()=>onFirstVerdict?.()).finally(release);
    await ready;
    const settled=await Promise.allSettled([first,mapLimit(items.slice(1),concurrencySetting('VENUE_CONCURRENCY',6),item=>investigate(item))]);
    const failed=settled.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  }else await mapLimit(items,concurrencySetting('VENUE_CONCURRENCY',6),item=>investigate(item));
  evaluate(ctx);
}
export async function checkContext(ctx:ToolContext,incremental=false) {
  const groups=new Map<string,Set<string>>();
  for(const item of ctx.trip.items){const city=item.city||ctx.trip.destinationCity;groups.set(city,(groups.get(city)??new Set()).add(dateForDay(ctx.trip.startDate,item.day)));}
  const weather=new Map<string,{city:string;date:string}>();
  for(const item of ctx.trip.items.filter(i=>i.kind==='scenic'||openArea(i))){const city=item.city||ctx.trip.destinationCity,date=dateForDay(ctx.trip.startDate,item.day);weather.set(`${city}:${date}`,{city,date});}
  const settled=await Promise.allSettled([
    mapLimit([...groups],2,async([city,dates])=>{
      let risk=ctx.result.dossiers.find(d=>d.venue.key===riskKey(city));
      if(!risk||risk.createdAt<ctx.run.createdAt){risk=await searchRisk(ctx.run.id,city,[...dates].sort());assertRunning();ctx.result.dossiers=ctx.result.dossiers.filter(d=>d.venue.key!==riskKey(city));ctx.result.dossiers.push(risk);ctx.persist();}
      await readRisk(ctx.run.id,ctx.trip,risk,ctx.result.dossiers);assertRunning();ctx.persist();
    }),
    incremental?Promise.resolve():mapLimit([...weather.values()],2,async({city,date})=>{
      const key=`weather:${city}:${date}`;
      if(ctx.result.dossiers.some(d=>d.venue.key===key&&d.createdAt>=ctx.run.createdAt))return;
      const dossier=await investigateWeather(ctx.run.id,city,date);assertRunning();ctx.result.dossiers=ctx.result.dossiers.filter(d=>d.venue.key!==key);ctx.result.dossiers.push(dossier);ctx.persist();
    }),
  ]);
  const failed=settled.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  ctx.state.contextDone=true;evaluate(ctx);
}
export async function findAlternatives(ctx:ToolContext,itemId:string) {
  if(ctx.state.alternativesDone.includes(itemId))return;
  const target=selectedItems(ctx,[itemId])[0];
  if(!target||unresolvedTarget(target))throw new AppError('INVALID_ALTERNATIVE','请先选定需要替代的具体场馆。');
  if(ctx.result.alternatives.length>=2)return;
  const remaining=2-ctx.result.alternatives.length;
  const found=await investigateAlternatives({...getRun(ctx.run.id),input:{itemId}},ctx.trip,remaining);assertRunning();
  for(const d of found.dossiers.filter(d=>d.venue.key.startsWith('alternatives:'))){
    const old=ctx.result.dossiers.find(old=>old.venue.id===d.venue.id);
    if(old){old.calls=[...new Map([...old.calls,...d.calls].map(c=>[c.id,c])).values()];old.searchedScope=[...new Set([...old.searchedScope,...d.searchedScope])];}
    else ctx.result.dossiers.push(d);
  }
  for(const a of found.alternatives.slice(0,remaining)){if(!ctx.result.dossiers.some(d=>d.venue.id===a.dossier.venue.id))ctx.result.dossiers.push(a.dossier);ctx.result.alternatives.push(a);}
  ctx.result.limitations.push(...found.limitations);ctx.state.alternativesDone.push(itemId);ctx.persist();
}
export function usefulBasis(j:Judgment){return j.verdict!=='unknown'||j.ruleStatus==='verified';}
