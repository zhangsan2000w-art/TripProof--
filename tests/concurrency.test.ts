import { expect, it } from 'vitest';
import { mapLimit, Semaphore } from '../lib/concurrency';
it('并行任务失败后等待已启动任务退出，避免结束后仍写结果',async()=>{let finished=false;await expect(mapLimit([0,1],2,async n=>{if(!n)throw new Error('failed');await new Promise(r=>setTimeout(r,10));finished=true;})).rejects.toThrow('failed');expect(finished).toBe(true);});
it('排队与新任务交错时仍遵守模型并发上限',async()=>{const gate=new Semaphore(3);let active=0,peak=0;const task=()=>gate.run(async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;});await Promise.all(Array.from({length:30},async()=>{await task();await task();}));expect(peak).toBe(3);expect(active).toBe(0);});
