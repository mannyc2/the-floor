import * as THREE from 'three';
import { ProjectionGenerator } from 'three-edge-projection';
import { mkdir,writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { cameraFor, type Rung } from './scene';
interface Point { x:number; y:number }
interface Segment { a:Point; b:Point }
const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function hull(input:Point[]):Point[]{
  const points=[...new Map(input.map(point=>[`${point.x.toFixed(10)},${point.y.toFixed(10)}`,point])).values()].sort((a,b)=>a.x-b.x||a.y-b.y);
  const half=(values:Point[])=>{const result:Point[]=[];for(const point of values){while(result.length>=2){const a=result[result.length-2],b=result[result.length-1];if(!a||!b||cross(a,b,point)>1e-9)break;result.pop();}result.push(point);}return result;};
  const lower=half(points),upper=half([...points].reverse());lower.pop();upper.pop();return lower.concat(upper);
}
function distance(point:Point,segment:Segment):number{const dx=segment.b.x-segment.a.x,dy=segment.b.y-segment.a.y,length=dx*dx+dy*dy;const t=length?Math.max(0,Math.min(1,((point.x-segment.a.x)*dx+(point.y-segment.a.y)*dy)/length)):0;return Math.hypot(point.x-segment.a.x-t*dx,point.y-segment.a.y-t*dy);}
const primitives=[{name:'box',geometry:new THREE.BoxGeometry(2.4,2.3,1.8)},{name:'cylinder-24',geometry:new THREE.CylinderGeometry(.52,.52,1.45,24)},{name:'tray',geometry:new THREE.BoxGeometry(3.6,.12,1.8)}];
const folder=`work/spikes/look/primitive-silhouettes/${process.env.LOOK_ATTEMPT??'002'}`;await mkdir(folder,{recursive:true});
const rows:unknown[]=[];let failures=0;
const browser=await chromium.launch({headless:true});
try{for(const primitive of primitives)for(const rung of ['district','works','machine']){
  const selected:Rung=rung==='district'?'district':rung==='works'?'works':'machine';
  const camera=cameraFor({rung:selected,width:480,height:360});
  // Convex hulls of projected vertices directly give these convex primitives' silhouettes;
  // this check does not use face normals, the candidate edge selector or the projection package.
  const vertices=primitive.geometry.getAttribute('position'),projected:Point[]=[];
  for(let i=0;i<vertices.count;i++){const point=new THREE.Vector3().fromBufferAttribute(vertices,i).project(camera);projected.push({x:(point.x+1)*240,y:(1-point.y)*180});}
  const boundary=hull(projected),boundarySegments:Segment[]=[];
  for(let i=0;i<boundary.length;i++){const a=boundary[i],b=boundary[(i+1)%boundary.length];if(a&&b)boundarySegments.push({a,b});}
  const transformed=primitive.geometry.clone().applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI/2).multiply(camera.matrixWorldInverse));
  const scene=new THREE.Scene();scene.add(new THREE.Mesh(transformed,new THREE.MeshBasicMaterial()));
  const generator=new ProjectionGenerator();generator.angleThreshold=35;generator.includeIntersectionEdges=true;
  const iterator=generator.generate(scene);let generated=iterator.next();while(!generated.done)generated=iterator.next();
  const edges=generated.value.visibleEdges.getLineGeometry().getAttribute('position'),scale=480/(camera.right-camera.left),segments:Segment[]=[];
  for(let i=0;i<edges.count;i+=2)segments.push({a:{x:(edges.getX(i)-camera.left)*scale,y:(edges.getZ(i)+camera.top)*scale},b:{x:(edges.getX(i+1)-camera.left)*scale,y:(edges.getZ(i+1)+camera.top)*scale}});
  let maxDistance=0,samples=0,maxOutside=0;
  for(const edge of boundarySegments){const count=Math.ceil(Math.hypot(edge.b.x-edge.a.x,edge.b.y-edge.a.y)*10);for(let i=0;i<=count;i++){const t=count?i/count:0,point={x:edge.a.x+(edge.b.x-edge.a.x)*t,y:edge.a.y+(edge.b.y-edge.a.y)*t};maxDistance=Math.max(maxDistance,Math.min(...segments.map(segment=>distance(point,segment))));samples++;}}
  for(const segment of segments)for(const point of [segment.a,segment.b])for(const edge of boundarySegments){const length=Math.hypot(edge.b.x-edge.a.x,edge.b.y-edge.a.y);maxOutside=Math.max(maxOutside,-cross(edge.a,edge.b,point)/length);}
  const pass=maxDistance<=.0001&&maxOutside<=.0001;if(!pass)failures++;
  const path=(lines:Segment[])=>lines.map(line=>`M${line.a.x},${line.a.y}L${line.b.x},${line.b.y}`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="white"/><path d="${path(segments)}" fill="none" stroke="black" stroke-width="1"/><path d="${path(boundarySegments)}" fill="none" stroke="#008080" stroke-width=".35"/></svg>`;
  await writeFile(`${folder}/${primitive.name}-${rung}.svg`,svg);
  if(rung==='works'){const page=await browser.newPage({viewport:{width:480,height:360}});await page.setContent(`<style>body{margin:0}</style>${svg}`);await page.screenshot({path:`${folder}/${primitive.name}-${rung}.png`});await page.close();}
  rows.push({primitive:primitive.name,rung,status:pass?'pass':'failed',hull_vertices:boundary.length,projection_segments:segments.length,boundary_samples:samples,max_silhouette_to_projection_css_px:maxDistance,max_projection_outside_hull_css_px:maxOutside,engineering_tolerance_css_px:.0001,projection_matrix:camera.projectionMatrix.toArray(),camera_matrix_world:camera.matrixWorld.toArray(),boundary,segments});
  transformed.dispose();
}
await writeFile(`${folder}/results.json`,JSON.stringify({method:'Direct convex hull of projected source vertices vs CPU target visible edges; sample hull every0.1CSSpx and verify target endpoints stay within hull. The check validates exterior silhouettes only, not every hidden/intersection edge.',tolerance_basis:'0.0001CSSpx numerical agreement check, far below the0.25CSSpx stroke allowance; not an owner art-quality threshold',failures,cases:rows},null,2));console.log(JSON.stringify({cases:rows.length,failures}));if(failures)process.exitCode=1;
}finally{await browser.close();primitives.forEach(item=>item.geometry.dispose());}
