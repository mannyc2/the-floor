import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Config } from './scene';
import type {} from './main';

const base=process.env.LOOK_URL??'http://127.0.0.1:5182';
const backend=process.env.LOOK_BACKEND==='webgpu'?'webgpu':'webgl';
const attempt=process.env.LOOK_ATTEMPT??'003';
const output=`work/spikes/look/technique-matrix/${attempt}/${backend}`;
const mode=process.env.LOOK_GPU_MODE??'software';
const repetitions=Number(process.env.LOOK_REPETITIONS??20);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(mode==='chrome'?{channel:'chrome'}:{}),args:mode==='chrome'?['--use-angle=metal']:['--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader',...(backend==='webgpu'?['--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader']:[])]});
const rows:unknown[]=[];
try {
  for(const technique of ['A','B','C'].filter(value=>!process.env.LOOK_TECHNIQUE||value===process.env.LOOK_TECHNIQUE))for(const theme of ['day','night'])for(const rung of ['district','works','machine'])for(const dpr of [1,2,3]) {
    const config:Config={technique:technique==='A'?'A':technique==='B'?'B':'C',theme:theme==='day'?'day':'night',rung:rung==='district'?'district':rung==='works'?'works':'machine',dpr,width:480,height:360,stalls:12,backend};
    const id=`${technique}-${theme}-${rung}-${dpr}`,folder=`${output}/${id}`;
    await mkdir(folder,{recursive:true});
    const page=await browser.newPage({viewport:{width:700,height:700},deviceScaleFactor:dpr});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    const hashes:string[]=[],pngBytes:number[]=[];let baseline:PNG|undefined,maxPixels=0,maxChannel=0,renderer='unknown',failure:string|undefined;
    try {
      await page.clock.install({time:new Date('2026-10-12T12:00:00Z')});
      await page.clock.pauseAt(new Date('2026-10-12T12:01:00Z'));
      const url=`${base}/?${new URLSearchParams(Object.entries(config).map(([key,value])=>[key,String(value)]))}`;
      for(let run=0;run<repetitions;run++) {
        await page.goto(url);await page.waitForFunction(()=>window.look?.ready||window.look?.error);
        const state=await page.evaluate(()=>({error:window.look.error,renderer:window.look.rendererString}));
        if(state.error)throw new Error(state.error);renderer=state.renderer;
        if(mode==='software'&&!renderer.toLowerCase().includes('swiftshader'))throw new Error(`Requested SwiftShader but observed ${renderer}`);
        if(mode==='chrome'&&!renderer.toLowerCase().includes('apple'))throw new Error(`Requested Apple hardware but observed ${renderer}`);
        await page.evaluate(()=>document.fonts.ready);
        await page.addStyleTag({content:'#labels{visibility:hidden}'});
        const bytes=await page.locator('canvas').screenshot({path:`${folder}/run-${String(run+1).padStart(2,'0')}.png`,animations:'disabled'});
        hashes.push(createHash('sha256').update(bytes).digest('hex'));pngBytes.push(bytes.length);
        const pixels=PNG.sync.read(bytes);
        if(baseline){let changed=0;for(let pixel=0;pixel<pixels.data.length;pixel+=4){let delta=0;for(let channel=0;channel<4;channel++)delta=Math.max(delta,Math.abs((pixels.data[pixel+channel]??0)-(baseline.data[pixel+channel]??0)));if(delta>0)changed++;maxChannel=Math.max(maxChannel,delta);}maxPixels=Math.max(maxPixels,changed/(pixels.width*pixels.height));}else baseline=pixels;
      }
      await page.evaluate(()=>window.look.mask(true));
      await page.locator('canvas').screenshot({path:`${folder}/edges.png`});
    }catch(error){failure=error instanceof Error?error.message:String(error);}
    const row={id,...config,status:failure?'failed':'pass',failure:failure??null,runs:hashes.length,renderer,browser:browser.version(),max_changed_pixel_fraction:maxPixels,max_channel_delta:maxChannel,hashes,pngBytes,errors};
    rows.push(row);await writeFile(`${folder}/result.json`,JSON.stringify(row,null,2));
    await writeFile(`${output}/results.json`,JSON.stringify(rows,null,2));
    console.log(JSON.stringify({id,status:row.status,runs:row.runs,maxPixels,error:failure??null}));
    await page.close();
  }
}finally{await browser.close();}
console.log(`Recorded ${rows.length} ${backend} cells in ${output}`);
