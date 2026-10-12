import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import type {} from './main';
const mode=process.env.LOOK_GPU_MODE??'software';
const folder=`work/spikes/look/webgpu-probe-${mode}`;await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,...(mode==='chrome'?{channel:'chrome'}:{}),args:mode==='software'?['--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader']:mode==='chrome'?['--use-angle=metal']:['--enable-unsafe-webgpu']});
try{for(const technique of ['A','B','C']){const page=await browser.newPage({viewport:{width:800,height:700}});page.on('console',message=>console.log(message.type(),message.text()));page.on('pageerror',error=>console.error(error));await page.goto(`http://127.0.0.1:5181/?backend=webgpu&technique=${technique}&rung=works`);await page.waitForFunction(()=>window.look?.ready||window.look?.error);const result=await page.evaluate(()=>({ready:window.look.ready,error:window.look.error,renderer:window.look.rendererString}));console.log(technique,JSON.stringify(result));await writeFile(`${folder}/${technique}.json`,JSON.stringify(result,null,2));await page.locator('#stage').screenshot({path:`${folder}/${technique}.png`});await page.close();}}finally{await browser.close();}
