import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { unlockTestClient } from './test-access';

const base=process.env.APP_URL || 'http://127.0.0.1:3000';
await mkdir('.data',{recursive:true});await mkdir('artifacts/browser',{recursive:true});
const files=Array.from({length:6},(_,i)=>`cases/hz${i+1}.jpg`);
const fixture='.data/browser-long-image.jpg';
await sharp({create:{width:1080,height:8640,channels:3,background:'#fff'}}).composite(await Promise.all(files.map(async(input,i)=>({input:await sharp(input).jpeg().toBuffer(),top:i*1440,left:0})))).jpeg({quality:90}).withExif({IFD0:{Artist:'TripProof EXIF test'}}).toFile(fixture);
expect((await sharp(fixture).metadata()).exif).toBeTruthy();
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{channel:'chrome'}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN'});
await unlockTestClient(page.request,base);
const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(r.method()==='POST')requests.push(new URL(r.url()).pathname);});
const result:Record<string,unknown>={testedAt:new Date().toISOString()};
try{
  await page.goto(base);await page.getByRole('tab',{name:'上传截图'}).click();
  await page.locator('input[type=file]').setInputFiles([...files,files[0]]);
  await expect(page.getByRole('alert').filter({hasText:'最多上传6张'})).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(fixture);
  await expect(page.locator('.upload-previews img')).toHaveCount(1);
  const sent=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/extract'&&r.method()==='POST');
  const started=Date.now();await page.getByRole('button',{name:'读取攻略，整理行程'}).click();
  const payload=(await sent).postDataJSON() as {images:{data:string;sourceIndex:number}[]};
  expect(payload.images.length).toBeGreaterThan(1);expect(payload.images.length).toBeLessThanOrEqual(30);
  for(const part of payload.images){expect(part.sourceIndex).toBe(1);const meta=await sharp(Buffer.from(part.data.split(',')[1],'base64')).metadata();expect(meta.exif).toBeUndefined();expect(meta.width).toBeLessThanOrEqual(1280);expect(meta.height!).toBeLessThanOrEqual(Math.round(meta.width!*1.6));}
  result.slices=payload.images.length;result.exifRemoved=true;result.maximumOriginalsEnforced=true;
  await expect(page.getByRole('heading',{name:'先对一遍，再出发查证。'})).toBeVisible({timeout:260000});
  result.extractionMs=Date.now()-started;
  const places=await page.locator('.place-input').evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value));
  for(const name of ['西湖','断桥','三潭印月','雷峰塔','河坊街','灵隐寺','法喜','拱宸桥','小河直街','武林夜市'])expect(places.some(p=>p.includes(name))).toBe(true);
  expect(await page.locator('input[type=time]').evaluateAll(inputs=>inputs.every(input=>!(input as HTMLInputElement).value))).toBe(true);
  await expect(page.getByAltText('原始攻略第1张')).toBeVisible();expect(await page.getByAltText('原始攻略第1张').getAttribute('src')).toMatch(/^blob:/);
  expect(await page.locator('.original-image-scroll').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await expect(page.getByRole('link',{name:'打开原图'})).toHaveAttribute('href',/^blob:/);
  expect(await page.getByAltText('原始攻略第1张').evaluate(el=>el.getBoundingClientRect().width/el.parentElement!.clientWidth)).toBeGreaterThan(.98);
  await page.getByLabel('第1项地点',{exact:true}).fill('杭州西湖');await expect(page.getByLabel('第1项地点',{exact:true})).toHaveValue('杭州西湖');
  await page.screenshot({path:'artifacts/browser/image-review-desktop.png',fullPage:false,caret:'initial'});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/browser/image-review-mobile.png',fullPage:false,caret:'initial'});
  expect(requests).toEqual(['/api/extract']);expect(errors).toEqual([]);
  Object.assign(result,{places,emptyPlannedTimes:true,originalComparison:true,scrollableOriginal:true,openOriginal:true,manualEdit:true,noSearchBeforeConfirmation:true,browserErrors:errors,passed:true});
  console.log(JSON.stringify(result));
}catch(error){result.passed=false;result.error=(error as Error).message;result.browserErrors=errors;console.error(error);process.exitCode=1;await page.screenshot({path:'artifacts/browser/image-failure.png',caret:'initial'});}
finally{await writeFile('artifacts/browser/images.json',JSON.stringify(result,null,2));await browser.close();}
