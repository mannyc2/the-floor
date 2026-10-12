import { KitScene, palette } from "@floor/kit";
import { Option } from "effect";
import * as THREE from "three";
import { type AtlasLayout, createLayout } from "./layout";
import { atlasMarket } from "./market-view";
import type { PlateRenderInput } from "./plate";

const zooms: Readonly<Record<PlateRenderInput["view"], number>> = {
  archipelago: 0.6,
  island: 1,
  district: 1.8,
  works: 3.2,
  machine: 5.2,
};
const setText = (id: string, value: string): void => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

function addLabels(
  layout: AtlasLayout,
  camera: THREE.OrthographicCamera,
  marketId: string,
  zoom: number,
  host: HTMLElement,
): void {
  const occupied: { readonly x: number; readonly y: number }[] = [];
  const labels = layout.labels.toSorted((a, b) =>
    (b.id === marketId ? 10000 : b.priority) - (a.id === marketId ? 10000 : a.priority)
  );
  for (const label of labels) {
    const isSelected = label.id === marketId;
    if (!isSelected && (zoom < label.minZoom || zoom > label.maxZoom)) continue;
    const point = new THREE.Vector3(...label.position).project(camera);
    const x = (point.x + 1) * 688, y = (1 - point.y) * 325;
    if (x < 80 || x > 1296 || y < 30 || y > 620 || point.z < -1 || point.z > 1) continue;
    if (!isSelected && occupied.some(item => Math.abs(item.x - x) < 160 && Math.abs(item.y - y) < 38)) continue;
    occupied.push({ x, y });
    const element = document.createElement("span");
    element.className = isSelected ? "label selected" : "label";
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.textContent = label.text;
    host.appendChild(element);
  }
}

export function renderPlateScene(input: PlateRenderInput, host: HTMLElement): void {
  const source = input.snapshot.market;
  const layout = createLayout(source.markets.map(atlasMarket), {
    lens: "flow",
    slots: input.snapshot.slots,
    tiers: input.snapshot.tiers,
    adoptedDesigns: input.snapshot.adoptedDesigns,
    activeMarketId: Option.fromNullOr(input.snapshot.activeMarketId),
    evidence: input.evidence,
    explodedId: Option.none(),
    moorings: new Set(),
  });
  const selected = layout.markets.find(item => item.market.id === input.marketId);
  if (!selected) {
    setText("status", "The selected market is absent from this retained source.");
    return;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.day.ground);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(1376, 650);
  host.appendChild(renderer.domElement);
  const kit = new KitScene(layout.parts, "day");
  kit.setDetail(3);
  scene.add(kit.group);
  const vertices: number[] = [];
  for (const path of layout.paths) {
    for (let index = 1; index < path.length; index++) {
      const from = path[index - 1], to = path[index];
      if (from && to) vertices.push(...from, ...to);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.LineBasicMaterial({
    color: palette.day.line,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
  });
  scene.add(new THREE.LineSegments(geometry, material));
  const zoom = zooms[input.view];
  const half = 39 / zoom;
  const aspect = 1376 / 650;
  const camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 1000);
  const target = input.view === "archipelago" || input.view === "island"
    ? new THREE.Vector3(0, 0, 3)
    : new THREE.Vector3(selected.x, 3, selected.z);
  camera.position.copy(target).addScaledVector(new THREE.Vector3(Math.sqrt(3 / 8), 0.5, Math.sqrt(3 / 8)), 220);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  addLabels(layout, camera, input.marketId, zoom, host);
  setText("title", input.title);
  setText("view", `${input.view.toUpperCase()} VIEW / SERVER RENDERED`);
  setText("market", `${selected.market.name} · ${selected.market.protocol} · ${input.marketId}`);
  setText("block", `BASE MAINNET / SOURCE BLOCK ${source.blockNumber.toLocaleString("en-US")}`);
  setText("time", `Source time ${source.blockTimestamp}`);
  setText("hash", `Block hash ${source.blockHash}`);
  setText(
    "provenance",
    source.source === "recording"
      ? "Provenance: retained Base recording"
      : "Provenance: retained Base chain observation",
  );
  setText(
    "status",
    `${layout.receiptStamps.length} confirmed receipt stamps within observed price traces. Public evidence is cut off at source time.`,
  );
  renderer.dispose();
  kit.dispose();
  geometry.dispose();
  material.dispose();
  document.documentElement.dataset["plateRendered"] = "true";
}
