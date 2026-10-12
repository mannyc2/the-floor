import type { AtlasLabel } from "@floor/renderer";
import { Array, Option, Record } from "effect";

/** Labels follow the imperative camera; sending frame positions through application state would redraw the whole UI. */
export const makeLabels = (host: HTMLElement) => {
  const layer = document.createElement("div");
  layer.className = "atlas-label-layer";
  layer.setAttribute("aria-hidden", "true");
  const elements: Record<string, HTMLElement> = {};
  host.appendChild(layer);
  return {
    update: (labels: readonly AtlasLabel[]) => {
      const visible = Array.filter(labels, label => label.visible);
      for (const id of Record.keys(elements)) {
        if (!Array.some(visible, label => label.id === id)) {
          elements[id]?.remove();
          delete elements[id];
        }
      }
      for (const label of visible) {
        const item = elements[label.id] ?? document.createElement("div");
        if (Option.isNone(Record.get(elements, label.id))) {
          elements[label.id] = item;
          layer.appendChild(item);
        }
        item.className = `atlas-label ${label.kind}${label.selected ? " selected" : ""}`;
        item.textContent = label.text;
        item.style.left = `${label.x}px`;
        item.style.top = `${label.y}px`;
      }
    },
    destroy: () => layer.remove(),
  };
};
