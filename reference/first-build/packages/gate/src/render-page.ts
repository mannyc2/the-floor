import { Design } from "@floor/contract";
import { KitScene, palette } from "@floor/kit";
import { Option, Result, Schema } from "effect";
import * as THREE from "three";
import { calibrationGeometryReadings, designGeometry, fitDesignGeometry } from "./geometry";
import { calibrationReadings } from "./review";

function renderView(
  host: HTMLElement,
  design: Design,
  samples: Readonly<Record<string, number>>,
  district: boolean,
): boolean {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.day.ground);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(680, 640);
  host.appendChild(renderer.domElement);
  const geometry = fitDesignGeometry(designGeometry(design, calibrationGeometryReadings(samples)), design.bounds);
  if (Option.isNone(geometry)) {
    renderer.dispose();
    return false;
  }
  const parts = geometry.value.parts;
  const kit = new KitScene(parts, "day");
  scene.add(kit.group);
  const pathMaterial = new THREE.LineBasicMaterial({ color: palette.day.brass });
  const paths = geometry.value.paths.map(path =>
    new THREE.BufferGeometry().setFromPoints(path.map(point => new THREE.Vector3(...point)))
  );
  for (const path of paths) scene.add(new THREE.Line(path, pathMaterial));
  const radius = Math.max(design.bounds.width, design.bounds.height, design.bounds.depth, 1) * (district ? 1.15 : 0.7);
  const camera = new THREE.OrthographicCamera(-radius * 1.0625, radius * 1.0625, radius, -radius, 0.1, 1000);
  const target = new THREE.Vector3(0, design.bounds.height * 0.32, 0);
  camera.position.copy(target).add(new THREE.Vector3(0.612, 0.5, 0.612).multiplyScalar(100));
  camera.lookAt(target);
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  const leaders = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaders.setAttribute("width", "680");
  leaders.setAttribute("height", "640");
  leaders.setAttribute("aria-hidden", "true");
  leaders.style.position = "absolute";
  leaders.style.left = "0";
  leaders.style.top = "0";
  host.appendChild(leaders);
  const labels = geometry.value.labels.map(binding => ({
    binding,
    point: new THREE.Vector3(...binding.position).project(camera),
  })).toSorted((a, b) => b.point.y - a.point.y);
  let leftY = 24, rightY = 24;
  for (const { binding, point } of labels) {
    const left = point.x < 0;
    const x = left ? 100 : 580;
    const y = Math.max(left ? leftY : rightY, Math.min(608, (1 - point.y) * 320));
    if (left) leftY = y + 28;
    else rightY = y + 28;
    const label = document.createElement("span");
    label.className = "instrument-label";
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
    label.textContent = `${binding.reading} ${binding.value.toFixed(2)}`;
    host.appendChild(label);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x + (left ? 1 : -1) * label.offsetWidth / 2));
    line.setAttribute("y1", String(y - label.offsetHeight / 2));
    line.setAttribute("x2", String((point.x + 1) * 340));
    line.setAttribute("y2", String((1 - point.y) * 320));
    line.setAttribute("stroke", palette.day.brass);
    line.setAttribute("stroke-opacity", "0.65");
    leaders.appendChild(line);
  }
  // The screenshot is the immutable artifact; GPU resources need not survive its first completed paint.
  renderer.dispose();
  kit.dispose();
  for (const path of paths) path.dispose();
  pathMaterial.dispose();
  return true;
}

function render(): void {
  const parsed = Schema.decodeResult(Schema.fromJsonString(Design))(decodeURIComponent(window.location.hash.slice(1)));
  const status = document.getElementById("status");
  if (!status) return;
  if (Result.isFailure(parsed)) {
    status.textContent = "A valid design declaration is required.";
    return;
  }
  const design = parsed.success;
  const samples = calibrationReadings(design);
  const title = document.getElementById("title");
  if (title) title.textContent = design.name;
  for (const id of ["close", "district"]) {
    const host = document.getElementById(id);
    if (!host || !renderView(host, design, samples, id === "district")) {
      status.textContent = "The declared geometry could not be rendered.";
      return;
    }
  }
  status.textContent =
    "Rendered calibration proof. Synthetic instrument values only; this is not a market observation.";
  document.documentElement.dataset["gateRendered"] = "true";
}

render();
