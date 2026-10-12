import { Config, defaults, exportScene } from './scene';
import { createRenderer } from './renderer';
import { createGpuRenderer } from './webgpu';

export interface BenchResult { frames:number; cpuMs:number[]; completedFrameMs:number[]; drawCalls:number; triangles:number; targetBytes:number; lineBufferBytes:number; gpuMs:number[] | 'unavailable'; gpuReason:string }
export interface LookAPI { ready:boolean; error:string | null; config:Config; rendererString:string; render:()=>void; mask:(value:boolean)=>void; scene:()=>ReturnType<typeof exportScene>; bench:(frames:number)=>Promise<BenchResult>; dispose:()=>void }
declare global { interface Window { look:LookAPI } }

const host=document.querySelector('#stage'), status=document.querySelector('#status');
if(!(host instanceof HTMLElement) || !(status instanceof HTMLElement)) throw new Error('Missing spike mount');
const query=new URLSearchParams(location.search);
const finite=(name:string,fallback:number)=>{const value=Number(query.get(name)??fallback);return Number.isFinite(value)&&value>0?value:fallback;};
const technique=query.get('technique'),theme=query.get('theme'),rung=query.get('rung');
const config:Config={...defaults,...(query.get('asset')==='rack'?{asset:'rack'}:{}),technique:technique==='B'?'B':technique==='C'?'C':'A',theme:theme==='night'?'night':'day',rung:rung==='works'?'works':rung==='machine'?'machine':'district',dpr:finite('dpr',devicePixelRatio),width:finite('width',480),height:finite('height',360),stalls:finite('stalls',12),backend:query.get('backend')==='webgpu'?'webgpu':'webgl'};
let mounted:ReturnType<typeof createRenderer>|Awaited<ReturnType<typeof createGpuRenderer>>|undefined;
window.look={ready:false,error:null,config,rendererString:'unavailable',render:()=>mounted?.draw(),mask:value=>mounted?.mask(value),scene:()=>{if(!mounted)throw new Error('Renderer unavailable');return exportScene(mounted.data);},bench,dispose:()=>mounted?.dispose()};

async function bench(frames:number):Promise<BenchResult> {
  if(!mounted)throw new Error('Renderer unavailable');
  const active=mounted,gl=active.context;
  const cpuMs:number[]=[],completedFrameMs:number[]=[],gpuMs:number[]=[];
  const extension:unknown=gl?.getExtension('EXT_disjoint_timer_query_webgl2');
  const elapsed=extension&&typeof extension==='object'&&'TIME_ELAPSED_EXT' in extension&&typeof extension.TIME_ELAPSED_EXT==='number'?extension.TIME_ELAPSED_EXT:undefined;
  const disjoint=extension&&typeof extension==='object'&&'GPU_DISJOINT_EXT' in extension&&typeof extension.GPU_DISJOINT_EXT==='number'?extension.GPU_DISJOINT_EXT:undefined;
  let calls=0,triangles=0;
  for(let i=0;i<10;i++)active.draw();
  await active.waitForGPU();
  if(!gl)await active.gpuTime();
  for(let frame=0;frame<frames;frame++) {
    const start=performance.now();
    const timer=gl instanceof WebGL2RenderingContext&&elapsed!==undefined?gl.createQuery():null;
    if(timer&&elapsed!==undefined&&gl instanceof WebGL2RenderingContext)gl.beginQuery(elapsed,timer);
    const result=active.draw();cpuMs.push(result.cpuMs);calls=result.drawCalls;triangles=result.triangles;
    if(timer&&elapsed!==undefined&&gl instanceof WebGL2RenderingContext)gl.endQuery(elapsed);
    await active.waitForGPU();completedFrameMs.push(performance.now()-start);
    if(!gl){const gpu=await active.gpuTime();if(gpu!==undefined)gpuMs.push(gpu);}
    if(timer&&gl instanceof WebGL2RenderingContext) {
      for(let attempt=0;attempt<200;attempt++) {
        const available:unknown=gl.getQueryParameter(timer,gl.QUERY_RESULT_AVAILABLE);
        if(available===true)break;
        await new Promise<void>(resolve=>setTimeout(resolve,2));
      }
      const value:unknown=gl.getQueryParameter(timer,gl.QUERY_RESULT);
      const invalid:unknown=disjoint===undefined?true:gl.getParameter(disjoint);
      if(typeof value==='number'&&invalid===false)gpuMs.push(value/1e6);
      gl.deleteQuery(timer);
    }
  }
  return{frames,cpuMs,completedFrameMs,drawCalls:calls,triangles,targetBytes:active.targetBytes,lineBufferBytes:active.lineBufferBytes,gpuMs:gpuMs.length?gpuMs:'unavailable',gpuReason:gpuMs.length?(gl?'EXT_disjoint_timer_query_webgl2, non-disjoint results only':'WebGPU timestamp-query via Three renderer'):'Timer query extension unavailable or no valid non-disjoint result; no invented GPU time'};
}

try {
  console.info('look-spike:mount',JSON.stringify(config));
  if(config.backend==='webgpu') {
    mounted=await createGpuRenderer(config,host);
  } else {mounted=createRenderer(config,host);}
  mounted.draw();
  window.look.rendererString=mounted.rendererString;window.look.ready=true;
  const labels=document.querySelector('#labels');
  if(labels instanceof HTMLElement) {
    for(const label of mounted.data.labels){const point=label.at.clone().project(mounted.data.camera),element=document.createElement('span');element.textContent=label.text;element.style.position='absolute';element.style.left=`${(point.x+1)*config.width/2}px`;element.style.top=`${(1-point.y)*config.height/2}px`;element.style.transform='translate(-50%,-50%)';labels.append(element);}
  }
  status.textContent=JSON.stringify({config,renderer:mounted.rendererString,source:'synthetic',approval:'pending'},null,2);
  console.info('look-spike:ready',mounted.rendererString);
}catch(error){const message=error instanceof Error?error.message:String(error);window.look.error=message;status.textContent=message;console.error('look-spike:failed',message);}
for(const id of ['technique','theme','rung']){const select=document.getElementById(id);if(select instanceof HTMLSelectElement)select.value=query.get(id)??select.value;}
document.getElementById('render')?.addEventListener('click',()=>{for(const id of ['technique','theme','rung']){const select=document.getElementById(id);if(select instanceof HTMLSelectElement)query.set(id,select.value);}location.search=query.toString();});
window.addEventListener('pagehide',()=>window.look.dispose(),{once:true});
