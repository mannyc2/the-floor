import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type {} from './main';
const output=`work/spikes/look/phone-profile/${process.env.LOOK_ATTEMPT??'003'}`;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal']});
const percentile=(values:number[],fraction:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*fraction)]??null;};
const summary=(values:number[])=>({p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),over16_7ms:values.filter(value=>value>16.7).length});
const rows:unknown[]=[];
try {
  for(const backend of ['webgl','webgpu'])for(const technique of ['A','B','C'])for(const stalls of [12,1000]) {
    const id=`${backend}-${technique}-${stalls}`,page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3});
    const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,gpu',transferMode:'ReturnAsStream'});
    let row:unknown;
    try{
      const params=new URLSearchParams({backend,technique,stalls:String(stalls),width:'390',height:'844',dpr:'3',rung:'district',theme:'day'});
      await page.goto(`${process.env.LOOK_URL??'http://127.0.0.1:5184'}/?${params}`);
      await page.waitForFunction(()=>window.look?.ready||window.look?.error);
      const state=await page.evaluate(()=>({error:window.look.error,renderer:window.look.rendererString,config:window.look.config}));
      if(state.error)throw new Error(state.error);
      if(!state.renderer.toLowerCase().includes('apple'))throw new Error(`Unintended GPU: ${state.renderer}`);
      await page.addStyleTag({content:'#labels{visibility:hidden}'});
      const result=await page.evaluate(()=>window.look.bench(120));
      await page.locator('canvas').screenshot({path:`${output}/${id}.png`});
      row={id,status:'pass',...state,...result,cpu:summary(result.cpuMs),completedFrame:summary(result.completedFrameMs),gpu:typeof result.gpuMs==='string'?result.gpuMs:summary(result.gpuMs),cpuBudget16_7ms:(percentile(result.cpuMs,.95)??Infinity)<=16.7,errors};
    }catch(error){row={id,status:'failed',error:error instanceof Error?error.message:String(error),errors};}
    const completed=new Promise<{stream?:string}>(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.end');const trace=await completed;
    if(trace.stream){let traceText='',done=false;while(!done){const chunk=await cdp.send('IO.read',{handle:trace.stream});traceText+=chunk.data;done=chunk.eof??false;}await cdp.send('IO.close',{handle:trace.stream});await writeFile(`${output}/${id}.trace.json`,traceText);}
    rows.push(row);await writeFile(`${output}/${id}.json`,JSON.stringify(row,null,2));await writeFile(`${output}/results.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify(row));await page.close();
  }
}finally{await browser.close();}
