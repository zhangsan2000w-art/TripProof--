import { request, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { TripState } from '../lib/domain';
import { quoteMatches } from '../lib/evidence';
import { unlockTestClient } from './test-access';
const base=process.env.APP_URL || 'http://127.0.0.1:3000';
const initial=JSON.parse(await readFile('artifacts/browser/flow-state.json','utf8')) as TripState;
const context=await request.newContext({baseURL:base,storageState:'.data/browser-state.json'});
await unlockTestClient(context,base);
async function post(path:string,body:unknown){const r=await context.post(path,{data:body});const j=await r.json();if(!r.ok())throw new Error(`${path}: ${JSON.stringify(j)}`);return j;}
async function wait(){const start=Date.now();let state:TripState;do{await new Promise(r=>setTimeout(r,2000));state=await (await context.get(`/api/trips/${initial.trip.id}`)).json();if(Date.now()-start>900000)throw new Error('Extension run timed out');}while(state.run?.status==='queued'||state.run?.status==='running');expect(state.run?.status).toBe('completed');return state;}
const results:Record<string,unknown>={testedAt:new Date().toISOString()};
try{
  await post(`/api/trips/${initial.trip.id}/announcements`,{text:'浙江省博物馆之江馆区公告：2026年10月27日全馆闭馆，2026年10月28日恢复开放。',images:[]});
  const announcement=await wait();expect(announcement.result?.announcement?.verdict).toBe('unknown');expect(announcement.result?.announcement?.evidenceIds.length).toBeGreaterThan(0);
  results.announcement={verdict:announcement.result?.announcement?.verdict,used:announcement.run?.used};
  const target=initial.trip.items.find(i=>i.kind==='museum')!;
  await post(`/api/trips/${initial.trip.id}/alternatives`,{itemId:target.id});
  const state=await wait(),alts=state.result?.alternatives??[];expect(alts.length).toBeLessThanOrEqual(2);
  for(const alt of alts){expect(alt.dossier.venue.city).toBe(target.city||initial.trip.destinationCity);for(const f of alt.dossier.facts){const e=alt.dossier.evidence.find(e=>e.id===f.evidenceId);expect(e&&quoteMatches(f.quote,e)).toBe(true);expect(f.venueMatch).toBe('exact');}for(const j of alt.judgments.filter(j=>j.type==='availability'))expect(j.verdict).toBe('unknown');}
  results.alternatives={count:alts.length,names:alts.map(a=>a.name),used:state.run?.used,limitations:state.run?.result?.limitations};results.passed=true;
  await writeFile('artifacts/browser/extensions-state.json',JSON.stringify(state,null,2));console.log(JSON.stringify(results));
}catch(error){results.passed=false;results.error=(error as Error).message;console.error(error);process.exitCode=1;}
finally{await writeFile('artifacts/browser/extensions.json',JSON.stringify(results,null,2));await context.dispose();}
