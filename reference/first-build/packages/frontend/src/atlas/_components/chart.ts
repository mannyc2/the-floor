import type { H } from "@/_components/ui";
import { Array } from "effect";

export const chart = (h: H, values: readonly number[], height = 100, className = "sparkline") => {
  if (values.length < 2) {
    return h.div([h.Class(`${className} no-chart`)], [h.span([], ["Waiting for two observed readings."])]);
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high === low ? Math.max(high * 0.01, 0.00001) : high - low;
  const width = 600;
  const path = Array.map(
    values,
    (value, index) =>
      `${index === 0 ? "M" : "L"}${index / (values.length - 1) * width},${
        height - 15 - (value - low) / range * (height - 30)
      }`,
  ).join(" ");
  return h.svg([
    h.Class(className),
    h.ViewBox(`0 0 ${width} ${height}`),
    h.PreserveAspectRatio("none"),
    h.Role("img"),
    h.AriaLabel("Observed price history"),
  ], [
    ...Array.map(
      [0.25, 0.5, 0.75],
      position =>
        h.keyed("path")(String(position), [
          h.D(`M0 ${height * position}H${width}`),
          h.Stroke("var(--rule)"),
          h.StrokeWidth("1"),
        ]),
    ),
    h.path([
      h.D(path),
      h.Fill("none"),
      h.Stroke("var(--ink)"),
      h.StrokeWidth("1.4"),
      h.VectorEffect("non-scaling-stroke"),
    ]),
  ]);
};
