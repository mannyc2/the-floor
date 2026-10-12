import * as THREE from 'three/webgpu';
import { attribute, normalView, uniform, uniformArray, float, vec2, vec3, texture, uv, mix, max, step, length, normalize, dot } from 'three/tsl';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { makeScene, Config, names, tokenColor } from './scene';
import { conditionalEdges } from './renderer';

export async function createGpuRenderer(config:Config,host:HTMLElement) {
  if(!navigator.gpu)throw new Error('navigator.gpu unavailable; native WebGPU not run');
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter)throw new Error('No native WebGPU adapter; fallback refused');
  const device=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[]});
  const gpuErrors:string[]=[];
  device.addEventListener('uncapturederror',event=>{gpuErrors.push(event.error.message);console.error('look-spike:webgpu-validation',event.error.message);});
  const renderer=new THREE.WebGPURenderer({device,trackTimestamp:true,antialias:false});
  renderer.setSize(config.width,config.height);renderer.setPixelRatio(config.dpr);renderer.info.autoReset=false;
  host.prepend(renderer.domElement);await renderer.init();
  if(!('isWebGPUBackend' in renderer.backend)||renderer.backend.isWebGPUBackend!==true)throw new Error('WebGL fallback refused');
  // Color objects store r/g/b; declaring vec3 would incorrectly upload x/y/z and produce black surfaces.
  const palette=uniformArray(names.map(name=>new THREE.Color(tokenColor(name,config.theme))),'color');
  const mask=uniform(0);
  const light=dot(normalize(normalView),normalize(vec3(-.4,.8,.45)));
  const shaded=light.greaterThan(.65).select(float(16),light.greaterThan(.1).select(float(15),light.greaterThan(-.5).select(float(14),float(13))));
  const materialIndex=attribute('_MAT','float').round();
  const index=materialIndex.greaterThanEqual(13).select(shaded,materialIndex).toUint();
  const material=new THREE.MeshBasicNodeMaterial({polygonOffset:config.technique==='C',polygonOffsetFactor:1,polygonOffsetUnits:1});
  material.colorNode=mix(palette.element(index),vec3(1),mask);
  const data=makeScene(config,material);
  const surface=attribute('_SURFACE','float').round();
  const encoded=vec3(surface.mod(256),surface.div(256).floor().mod(256),surface.div(65536).floor()).div(255);
  const dataMaterial=new THREE.MeshBasicNodeMaterial();
  dataMaterial.colorNode=config.technique==='A'?normalView.normalize().mul(.5).add(.5):encoded;
  const width=config.width*config.dpr,height=config.height*config.dpr;
  const colorTarget=new THREE.RenderTarget(width,height,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,type:THREE.UnsignedByteType});
  colorTarget.texture.colorSpace=THREE.LinearSRGBColorSpace;
  const dataTarget=new THREE.RenderTarget(width,height,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,type:THREE.UnsignedByteType});
  dataTarget.texture.colorSpace=THREE.LinearSRGBColorSpace;
  dataTarget.depthTexture=new THREE.DepthTexture(width,height,THREE.UnsignedIntType);
  // The full-screen plane has bottom-left UVs; WebGPU render-target storage is top-left.
  const sampleUV=uv().flipY();
  const base=texture(colorTarget.texture,sampleUV),features=texture(dataTarget.texture,sampleUV),depth=texture(dataTarget.depthTexture,sampleUV);
  const edgeAt=(x:number,y:number)=>{
    const at=sampleUV.add(vec2(x/width,y/height));
    const change=length(features.sample(at).rgb.sub(features.rgb));
    return max(step(config.technique==='A'?.3:.001,change),step(.0012,depth.sample(at).r.sub(depth.r).abs()));
  };
  const behind=Math.floor(config.dpr/2),ahead=Math.ceil(config.dpr/2);
  const edge=max(max(edgeAt(ahead,0),edgeAt(-behind,0)),max(edgeAt(0,ahead),edgeAt(0,-behind)));
  const screenMaterial=new THREE.MeshBasicNodeMaterial({depthTest:false,depthWrite:false});
  screenMaterial.colorNode=mix(mix(base.rgb,uniform(new THREE.Color(tokenColor('line',config.theme))),edge.mul(config.theme==='night'?.7:1)),vec3(float(1).sub(edge)),mask);
  const screenScene=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),screenMaterial);screenScene.add(quad);
  const screenCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);screenCamera.position.z=.5;
  const lineGeometry=new LineSegmentsGeometry();
  // Node line material uses the physical viewport, unlike the WebGL addon.
  const lineMaterial=new THREE.Line2NodeMaterial({color:tokenColor('line',config.theme),linewidth:config.dpr,depthTest:true,depthWrite:false,transparent:config.theme==='night',opacity:config.theme==='night'?.7:1});
  const positions:number[]=[];
  if(config.technique==='C') {
    const view=new THREE.Vector3();data.camera.getWorldDirection(view);
    for(const mesh of data.meshes) {
      const edges=conditionalEdges(mesh.geometry,view),count=mesh instanceof THREE.InstancedMesh?mesh.count:1;
      for(let instance=0;instance<count;instance++) {
        const matrix=new THREE.Matrix4();if(mesh instanceof THREE.InstancedMesh)mesh.getMatrixAt(instance,matrix);
        for(let i=0;i<edges.length;i+=3){const point=new THREE.Vector3(edges[i],edges[i+1],edges[i+2]).applyMatrix4(matrix);positions.push(point.x,point.y,point.z);}
      }
    }
    lineGeometry.setPositions(positions);const lines=new LineSegments2(lineGeometry,lineMaterial);lines.frustumCulled=false;lines.renderOrder=1;data.scene.add(lines);
  }
  function draw(){
    renderer.info.reset();const start=performance.now();
    if(config.technique==='C'){renderer.setRenderTarget(null);renderer.setClearColor(mask.value?'white':tokenColor('ground',config.theme));renderer.render(data.scene,data.camera);}
    else{renderer.setRenderTarget(colorTarget);renderer.setClearColor(tokenColor('ground',config.theme));renderer.render(data.scene,data.camera);renderer.setRenderTarget(dataTarget);renderer.setClearColor(0);data.scene.overrideMaterial=dataMaterial;renderer.render(data.scene,data.camera);data.scene.overrideMaterial=null;renderer.setRenderTarget(null);renderer.render(screenScene,screenCamera);}
    return{cpuMs:performance.now()-start,drawCalls:renderer.info.render.drawCalls,triangles:renderer.info.render.triangles};
  }
  await renderer.compileAsync(data.scene,data.camera);await renderer.compileAsync(screenScene,screenCamera);
  draw();await renderer.waitForGPU();
  if(gpuErrors.length)throw new Error(gpuErrors.join('\n'));
  return{renderer,data,draw,context:null,waitForGPU:()=>renderer.waitForGPU(),gpuTime:async():Promise<number|undefined>=>{const value=await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);return typeof value==='number'?value:undefined;},rendererString:`WebGPU ${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.device} ${adapter.info.description}`,targetBytes:config.technique==='C'?0:width*height*16,lineBufferBytes:positions.length*4,
    mask(value:boolean){mask.value=value?1:0;lineMaterial.color.set(value?'black':tokenColor('line',config.theme));lineMaterial.opacity=value?1:config.theme==='night'?.7:1;draw();},
    dispose(){data.geometries.forEach(geometry=>geometry.dispose());material.dispose();dataMaterial.dispose();lineGeometry.dispose();lineMaterial.dispose();colorTarget.dispose();dataTarget.dispose();screenMaterial.dispose();quad.geometry.dispose();renderer.dispose();device.destroy();renderer.domElement.remove();}
  };
}
