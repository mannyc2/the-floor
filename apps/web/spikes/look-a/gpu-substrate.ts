import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
const mode=process.env.LOOK_BROWSER==='chrome'?'chrome':'bundled';const folder=`work/spikes/look/webgpu-substrate-${mode}`;await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:mode!=='chrome',...(mode==='chrome'?{channel:'chrome'}:{}),args:mode==='chrome'?['--use-angle=metal']:['--enable-unsafe-webgpu']});
try{const page=await browser.newPage();await page.goto('http://127.0.0.1:5181');const result=await page.evaluate(async()=>{
  const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return{error:'No adapter'};
  const device=await adapter.requestDevice(),errors:string[]=[];device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;document.body.replaceChildren(canvas);const context=canvas.getContext('webgpu');if(!context)return{error:'No context'};
  context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});
  const texture=context.getCurrentTexture(),encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),clearValue:{r:1,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
  return{adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description},format:navigator.gpu.getPreferredCanvasFormat(),errors};
});console.log(JSON.stringify(result,null,2));await writeFile(`${folder}/result.json`,JSON.stringify(result,null,2));await page.screenshot({path:`${folder}/screenshot.png`});}finally{await browser.close();}
