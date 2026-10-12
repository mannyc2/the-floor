import { MeshBasicMaterial } from 'three';
import { defaults, makeScene, exportScene } from './scene';
const data=makeScene(defaults,new MeshBasicMaterial());
await Bun.write('work/spikes/look/scene.json',JSON.stringify(exportScene(data)));
console.log('Exported new stand-in scene and exact camera matrices to work/spikes/look/scene.json');
