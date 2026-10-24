import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { requestYuanbaoSearch } from '../lib/search/yuanbao';
const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['国务院办公厅 2026年 部分节假日安排 通知 gov.cn', '南京博物院 开放时间 周一闭馆 官方', '浙江省博物馆 开放时间 周一闭馆 官方', '中国丝绸博物馆 参观时间 周一 官方', '临安博物馆 开放时间 官方', '故宫博物院 参观须知 周一闭馆 官方', '中国国家博物馆 开放时间 预约 官方'];
await mkdir('artifacts/sources', { recursive: true });
for (const [index,query] of queries.entries()) {
  const data = await requestYuanbaoSearch({Query:query,...(process.env.WSA_DISCOVERY_SITE?{Site:process.env.WSA_DISCOVERY_SITE}:{}),...(process.env.WSA_DISCOVERY_GOV?{Industry:'gov'}:{})});
  const pages=(data.Pages ?? []).map((p:unknown)=>typeof p==='string'?JSON.parse(p):p);
  const result={query,requestId:data.RequestId,error:data.Error,checkedAt:new Date().toISOString(),pages};
  await writeFile(`artifacts/sources/${process.argv.slice(2).length ? createHash('sha256').update(query).digest('hex').slice(0,10) : index}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({query,requestId:data.RequestId,error:data.Error,pages:pages.slice(0,5).map((p:Record<string,unknown>)=>({title:p.title,url:p.url,passage:String(p.passage??'').slice(0,800)}))}));
}
