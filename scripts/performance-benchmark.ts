import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Isolated database: this benchmark never reads credentials or calls a provider.
const directory=mkdtempSync(join(tmpdir(),'tripproof-perf-'));
process.env.DATABASE_PATH=join(directory,'benchmark.db');
const globalDB=globalThis as unknown as {tripproofDB?:{sqlite:{close():void}}};
const disconnect=()=>{globalDB.tripproofDB?.sqlite.close();delete globalDB.tripproofDB;};
try{
  const {initializeSampleReports}=await import('../lib/sample-bundle');
  const path=resolve('data/sample-reports.json');
  const began=performance.now(),first=initializeSampleReports(path),initialMs=performance.now()-began;
  const restarts:number[]=[];
  for(let n=0;n<3;n++){
    disconnect();const start=performance.now(),result=initializeSampleReports(path);
    if(result.imported!==0||result.featured!==first.featured)throw new Error('Startup changed the imported reports.');
    restarts.push(performance.now()-start);
  }
  console.log(JSON.stringify({mode:'offline-isolated-database',bundleBytes:statSync(path).size,firstImportMs:Math.round(initialMs),restartMs:restarts.map(Math.round),imported:first.imported,featured:first.featured,liveApiTested:false},null,2));
}finally{
  disconnect();
  if(dirname(resolve(directory))!==resolve(tmpdir()))throw new Error('Unexpected benchmark directory.');
  rmSync(directory,{recursive:true,force:true});
}
