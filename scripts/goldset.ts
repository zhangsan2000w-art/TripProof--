import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { normalizePage } from '../lib/search/yuanbao';
import { verifyEvidence } from '../lib/evidence';
import { extractFacts, retierDossier } from '../lib/facts';
import { judgeItem } from '../lib/judge';
import type { CheckType, Dossier, Item, TripInput, Verdict } from '../lib/domain';
import { mapLimit } from '../lib/concurrency';
const source=JSON.parse(await readFile('data/goldset-sources.json','utf8')) as {groups:{name:string;city:string;checkedAt:string;requestId:string;pages:Record<string,unknown>[];checks:{date:string;start?:string;type:CheckType;expected:Verdict}[]}[]};
await mkdir('artifacts/goldset',{recursive:true});
const checks:Record<string,unknown>[]=[];
await mapLimit(source.groups,2,async(group,index)=>{
  const evidence=await mapLimit(group.pages,2,async raw=>verifyEvidence(normalizePage(raw,group.requestId)!,group.name));
  let extracted;
  const cacheFile=`artifacts/goldset/venue-${index}.json`;
  if(process.argv.includes('--reuse-facts')) extracted=JSON.parse(await readFile(cacheFile,'utf8')).extracted;
  else extracted=await extractFacts(`goldset-${index}`,group.name,group.city,group.checks.map(c=>c.date),evidence);
  const d:Dossier={venue:{id:`goldset-${index}`,key:`${group.city}:${group.name}`,canonicalName:group.name,city:group.city,officialDomain:extracted.officialDomain,officialEvidenceId:extracted.officialEvidenceId,investigationDates:group.checks.map(c=>c.date)},facts:extracted.facts,evidence,calls:[],searchedScope:group.pages.map(p=>String(p.url)),limitations:extracted.ambiguities,createdAt:new Date().toISOString()};
  retierDossier(d);
  await writeFile(cacheFile,JSON.stringify({name:group.name,checkedAt:new Date().toISOString(),sourceCheckedAt:group.checkedAt,requestId:group.requestId,extracted,evidence},null,2));
  for(const [n,c] of group.checks.entries()){
    const item:Item={id:`${index}-${n}`,day:1,seq:1,placeName:group.name,city:group.city,kind:'museum',activity:'标准评测',sourceText:group.name,sourceImage:null,confidence:1,dependsOn:[],start:c.start??'10:00',end:null,claimedRules:[]};
    const trip:TripInput={title:'标准评测',startDate:c.date,originCity:'',destinationCity:group.city,arriveDay1:null,leaveLastDay:null,mode:'transit',guidePublishedAt:null,items:[item]};
    const judgment=judgeItem(item,trip,d).find(j=>j.type===c.type);
    const row={name:group.name,...c,actual:judgment?.verdict,reason:judgment?.reasonCode,passed:judgment?.verdict===c.expected,wrongConfirmation:c.expected!=='confirmed'&&judgment?.verdict==='confirmed',urls:group.pages.map(p=>p.url),checkedAt:new Date().toISOString()};
    checks.push(row);console.log(JSON.stringify(row));
  }
});
const accuracy=checks.filter(c=>c.passed).length/checks.length, wrongConfirmations=checks.filter(c=>c.wrongConfirmation).length;
const result={testedAt:new Date().toISOString(),mode:process.argv.includes('--reuse-facts')?'stored facts + checked links':'real model + checked links',total:checks.length,accuracy,wrongConfirmations,passed:accuracy>=.8&&wrongConfirmations===0,checks};
await writeFile('artifacts/goldset/summary.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({total:result.total,accuracy,wrongConfirmations,passed:result.passed}));if(!result.passed)process.exitCode=1;
