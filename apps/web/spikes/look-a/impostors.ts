import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import type {} from './main';
const folder=`work/spikes/look/impostors/${process.env.LOOK_ATTEMPT??'003'}`;await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=metal']});
const rows:unknown[]=[];
try{for(const backend of ['webgl','webgpu'])for(const technique of ['A','B','C']){
  const page=await browser.newPage({viewport:{width:600,height:600},deviceScaleFactor:1}),id=`${backend}-${technique}`;
  const masks:Record<string,PNG>={};
  for(const width of [256,64]){
    const url=new URL(process.env.LOOK_URL??'http://127.0.0.1:5184');url.search=new URLSearchParams({technique,backend,asset:'rack',rung:'works',width:String(width),height:String(width),dpr:'1'}).toString();
    await page.goto(url.href);await page.waitForFunction(()=>window.look?.ready||window.look?.error);const failure=await page.evaluate(()=>window.look.error);if(failure)throw new Error(failure);
    await page.addStyleTag({content:'#labels{visibility:hidden}'});
    await page.locator('canvas').screenshot({path:`${folder}/${id}-${width}.png`});await page.evaluate(()=>window.look.mask(true));
    const bytes=await page.locator('canvas').screenshot({path:`${folder}/${id}-${width}-mask.png`});masks[String(width)]=PNG.sync.read(bytes);
  }
  // Area averaging is an explicit static sprite/mipmap bake, with no post-sampling outline.
  const source=masks['256'],direct=masks['64'];if(!source||!direct)throw new Error('Missing bake inputs');
  const sprite=new PNG({width:64,height:64});let highEdges=0,retainedEdges=0,bakedBlack=0,directBlack=0;
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    let total=0,edges=0;for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++){const gray=source.data[((y*4+dy)*256+x*4+dx)*4]??255;total+=gray;if(gray<128)edges++;}
    const gray=Math.round(total/16),at=(y*64+x)*4;sprite.data[at]=gray;sprite.data[at+1]=gray;sprite.data[at+2]=gray;sprite.data[at+3]=255;highEdges+=edges;if(gray<128){retainedEdges+=edges;bakedBlack++;}if((direct.data[at]??255)<128)directBlack++;
  }
  await writeFile(`${folder}/${id}-sprite64-mask.png`,PNG.sync.write(sprite));
  const row={id,bakeCss:256,spriteCss:64,downsample:'4×4 exact area average, no outline after sampling',highResolutionEdgePixels:highEdges,edgePixelsRetainedAtHalfDarkness:retainedEdges,edgeSurvivalFraction:retainedEdges/highEdges,bakedHalfDarkPixels:bakedBlack,directHalfDarkPixels:directBlack,directToBakedCoverage:bakedBlack/directBlack};rows.push(row);await page.close();
}await writeFile(`${folder}/results.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));}finally{await browser.close();}
