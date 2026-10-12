"""Measure captured Part A line masks against the validated CPU edge-projection target.

Requires NumPy and Pillow. Captures must exclude DOM labels and use the shared scene.
"""

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import statistics

import numpy as np
from PIL import Image, ImageDraw


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def grayscale(path):
    rgba = Image.open(path).convert("RGBA")
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return np.asarray(Image.alpha_composite(white, rgba).convert("L"))


def expand_disk(mask, radius):
    height, width = mask.shape
    padded = np.pad(mask, radius)
    expanded = np.zeros_like(mask)
    # DPR is at most three, so integer Euclidean-disk shifts are exact and avoid
    # an extra image-processing dependency or a square-neighborhood bias.
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx * dx + dy * dy <= radius * radius:
                expanded |= padded[radius + dy : radius + dy + height, radius + dx : radius + dx + width]
    return expanded


def scores(prediction, target, dpr):
    if prediction.shape != target.shape:
        raise ValueError(f"Image dimensions differ: {prediction.shape} versus {target.shape}")
    predicted_count, target_count = int(prediction.sum()), int(target.sum())
    if not predicted_count or not target_count:
        return {"prediction_pixels": predicted_count, "target_pixels": target_count, "exact_f1": 0.0 if target_count else None, "tolerant_f1": 0.0 if target_count else None, "limitation": "Empty prediction or target; no vacuous perfect score assigned"}
    intersection = int((prediction & target).sum())
    precision = float((prediction & expand_disk(target, dpr)).sum() / predicted_count)
    recall = float((target & expand_disk(prediction, dpr)).sum() / target_count)
    return {"prediction_pixels": predicted_count, "target_pixels": target_count, "exact_precision": intersection / predicted_count, "exact_recall": intersection / target_count, "exact_f1": 2 * intersection / (predicted_count + target_count), "tolerant_precision": precision, "tolerant_recall": recall, "tolerant_f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0}


def camera_matrices(scene, rung):
    camera = scene["cameras"][rung]
    world = np.asarray(camera["matrixWorld"]).reshape(4, 4).T
    projection = np.asarray(camera["projectionMatrix"]).reshape(4, 4).T
    return world, projection @ np.linalg.inv(world)


def project(point, transform, viewport, dpr):
    clip = transform @ np.asarray([*point, 1])
    return ((clip[0] / clip[3] + 1) * viewport["width"] * dpr / 2, (1 - clip[1] / clip[3]) * viewport["height"] * dpr / 2)


def drum_geometry(scene):
    slot = next(index for index, item in enumerate(scene["palette"]) if item["name"] == "paper")
    mesh = next(item for item in scene["meshes"] if item["name"] == "tide-gauge-0")
    points = np.asarray(mesh["positions"]).reshape(-1, 3)
    selected = points[np.asarray(mesh["materialSlots"]) == slot]
    lower, upper = selected.min(axis=0), selected.max(axis=0)
    return {"center": (lower + upper) / 2, "radius": (upper[0] - lower[0]) / 2, "bottom": lower[1], "top": upper[1]}


def drum_roi(scene, rung, dpr, shape):
    drum = drum_geometry(scene)
    world, transform = camera_matrices(scene, rung)
    yaw = math.atan2(world[0, 2], world[2, 2])
    span = drum["top"] - drum["bottom"]
    lower, upper = drum["bottom"] + span * .25, drum["top"] - span * .25
    angles = np.linspace(yaw - math.pi / 2, yaw + math.pi / 2, 97)
    boundary = []
    for y, arc in [(upper, angles), (lower, angles[::-1])]:
        for theta in arc:
            boundary.append(project((drum["center"][0] + drum["radius"] * math.sin(theta), y, drum["center"][2] + drum["radius"] * math.cos(theta)), transform, scene["viewport"], dpr))
    image = Image.new("1", (shape[1], shape[0]), 0)
    ImageDraw.Draw(image).polygon(boundary, fill=1)
    region = np.asarray(image, dtype=bool)
    # The middle half of the barrel removes its caps; two CSS pixels of erosion
    # exclude the nominal one-pixel silhouette plus rasterization uncertainty.
    region = region & ~expand_disk(~region, 2 * dpr)
    return region, {"source_mesh": "tide-gauge-0", "palette": "paper", "world_y_interval": [float(lower), float(upper)], "visible_half_yaw_radians": yaw, "boundary_erosion_css_px": 2, "pixel_count": int(region.sum()), "area_css_px_squared": float(region.sum() / (dpr * dpr)), "projected_boundary_raster_xy": boundary}


def cylinder_density(prediction, target, roi, dpr):
    false_lines = prediction & roi & ~expand_disk(target, dpr)
    area = int(roi.sum())
    if not area:
        return {"status": "empty_roi", "false_line_pixels": 0, "mean_false_crossings_per_100_css_px": None}
    densities = []
    crossings = 0
    for y in range(0, roi.shape[0], dpr):
        columns = int(roi[y].sum())
        if not columns:
            continue
        row = false_lines[y]
        starts = row & ~np.r_[False, row[:-1]]
        count = int(starts.sum())
        crossings += count
        densities.append(count * 100 / (columns / dpr))
    return {"status": "measured", "false_line_pixels": int(false_lines.sum()), "false_line_pixel_fraction_of_roi": float(false_lines.sum() / area), "horizontal_scan_rows": len(densities), "false_run_crossings": crossings, "mean_false_crossings_per_100_css_px": statistics.mean(densities) if densities else None}


def cylinder_width(gray, scene, rung, dpr):
    drum = drum_geometry(scene)
    world, transform = camera_matrices(scene, rung)
    right = world[:3, 0].copy()
    right[1] = 0
    right /= np.linalg.norm(right)
    point = drum["center"] + drum["radius"] * right
    x, y = project(point, transform, scene["viewport"], dpr)
    center, row_y = round(x), round(y)
    start, end = max(0, center - 5 * dpr), min(gray.shape[1], center + 5 * dpr)
    row = gray[row_y, start:end]
    dark = row < 128
    boundaries = np.diff(np.r_[False, dark, False].astype(int))
    starts, ends = np.where(boundaries == 1)[0], np.where(boundaries == -1)[0]
    if len(starts):
        candidates = [(abs((left + right - 1) / 2 + start - x), left, right) for left, right in zip(starts, ends)]
        distance, left, right = min(candidates)
        width = (right - left) / dpr if distance <= 2 * dpr else 0.0
    else:
        distance, width = None, 0.0
    return {"world_point": point.tolist(), "sample_css_xy": [x / dpr, y / dpr], "raster_row": row_y, "raster_window_x": [start, end], "threshold_width_css_px": float(width), "nearest_run_distance_css_px": float(distance / dpr) if distance is not None else None, "integrated_darkness_css_px": float(((255 - row) / 255).sum() / dpr), "within_1_plus_minus_0_25": bool(.75 <= width <= 1.25), "scope": "One clean paper-cylinder silhouette profile; not every orientation, join or line in the frame"}


def summary(rows):
    measured = [row for row in rows if row["status"] == "measured"]
    result = {}
    for technique in sorted({row["technique"] for row in rows}):
        selected = [row for row in measured if row["technique"] == technique]
        if not selected:
            result[technique] = {"measured_cells": 0, "status": "no_measured_cells"}
            continue
        metrics = {}
        for name, values in {
            "exact_f1": [row["against_target"]["exact_f1"] for row in selected],
            "tolerant_f1": [row["against_target"]["tolerant_f1"] for row in selected],
            "cylinder_width_css_px": [row["cylinder_width"]["threshold_width_css_px"] for row in selected],
            "false_crossings_per_100_css_px": [row["cylinder_interior"]["mean_false_crossings_per_100_css_px"] for row in selected],
        }.items():
            present = [value for value in values if value is not None]
            metrics[name] = {"mean": statistics.mean(present), "min": min(present), "max": max(present)} if present else None
        result[technique] = {"measured_cells": len(selected), "local_stroke_width_failures": sum(not row["cylinder_width"]["within_1_plus_minus_0_25"] for row in selected), **metrics}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures", type=Path, required=True)
    parser.add_argument("--targets", type=Path, required=True)
    parser.add_argument("--primitive-report", type=Path, required=True)
    parser.add_argument("--scene", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    scene = json.loads(args.scene.read_text())
    target_report = json.loads((args.targets / "manifest.json").read_text())
    primitive_report = json.loads(args.primitive_report.read_text())
    if digest(args.scene) != target_report["source_scene_sha256"]:
        raise ValueError("CPU targets do not use the current shared scene")
    if primitive_report["failures"]:
        raise ValueError("Primitive silhouette validation failed")
    rows, target_cache, target_checks = [], {}, []
    for metadata_path in sorted(args.captures.glob("*/result.json")):
        metadata = json.loads(metadata_path.read_text())
        row = {key: metadata[key] for key in ["id", "technique", "theme", "rung", "dpr", "backend"]}
        capture = metadata_path.parent / "edges.png"
        if metadata["status"] != "pass" or not capture.exists():
            rows.append({**row, "status": "not_measured", "capture_status": metadata["status"], "reason": metadata.get("failure") or "Missing edge mask"})
            continue
        rung, dpr = metadata["rung"], metadata["dpr"]
        key = (rung, dpr)
        if key not in target_cache:
            path = args.targets / f"{rung}-{dpr}.png"
            target_gray = grayscale(path)
            target = target_gray < 128
            roi, specification = drum_roi(scene, rung, dpr, target.shape)
            target_cache[key] = (target, roi, path)
            target_checks.append({"rung": rung, "dpr": dpr, "target_local_stroke_width": cylinder_width(target_gray, scene, rung, dpr), "cylinder_roi": specification, "target_sha256": digest(path)})
        target, roi, target_path = target_cache[key]
        gray = grayscale(capture)
        prediction = gray < 128
        row.update(status="measured", capture=str(capture), capture_sha256=digest(capture), target=str(target_path), against_target=scores(prediction, target, dpr), cylinder_width=cylinder_width(gray, scene, rung, dpr), cylinder_interior=cylinder_density(prediction, target, roi, dpr))
        rows.append(row)
    output = {"methodology": {
        "ground_truth":"three-edge-projection CPU visible-edge extraction using identical scene vertices and orthographic camera; current owner decision in docs/decisions.md",
        "threshold":"8-bit grayscale <128 after alpha composite on white",
        "exact":"Pixel precision, recall and harmonic-mean F1 with no spatial tolerance",
        "tolerant":"Precision matches predicted pixels within a Euclidean disk of radius DPR around target pixels; recall reverses roles. Radius is exactly 1 CSS pixel. F1 is harmonic mean; matching is many-to-many, not skeleton or topology accuracy.",
        "cylinder_interior":"Visible front half of source paper drum, middle 50% of world-space height, projected and eroded by 2 CSS pixels. False pixels exclude any pixel within 1 CSS pixel of a CPU target line. On one horizontal row per CSS pixel, count contiguous false runs and divide by the row ROI width in CSS pixels, times100; report mean across rows.",
        "stroke":"Nearest thresholded contiguous run within 2 CSS pixels of the clean drum right silhouette midpoint; report threshold width and full-profile integrated darkness. Only width1 +/-0.25 is treated as a requirement from the handoff.",
        "limits":["Single synthetic stand-in scene, not art quality or approval.","DOM labels are hidden before capture.","One clean-cylinder profile cannot establish all-angle stroke widths.","Pixel F1 is sensitive to rasterizer phase, thickness and occlusion semantics.","The primitive check validates convex outer silhouettes, not all hidden/intersection edges.","Cylinder ROI may miss defects elsewhere; no quality cutoff was invented for F1 or density.","Unsupported or missing cells remain explicitly unmeasured."]},
        "source_scene_sha256":digest(args.scene), "captures":str(args.captures), "targets":str(args.targets),
        "primitive_validation":{"path":str(args.primitive_report),"sha256":digest(args.primitive_report),"cases":len(primitive_report["cases"]),"failures":primitive_report["failures"]},
        "cells":rows, "by_technique":summary(rows), "target_checks":target_checks}
    (args.out / "metrics.json").write_text(json.dumps(output, indent=2) + "\n")
    with (args.out / "metrics.csv").open("w",newline="") as stream:
        writer=csv.writer(stream,lineterminator="\n")
        writer.writerow(["id","status","technique","theme","rung","dpr","exact_f1","tolerant_1_css_f1","local_width_css","width_within_requirement","false_crossings_per_100_css_px"])
        for row in rows:
            if row["status"]=="measured":
                writer.writerow([row["id"],row["status"],row["technique"],row["theme"],row["rung"],row["dpr"],row["against_target"]["exact_f1"],row["against_target"]["tolerant_f1"],row["cylinder_width"]["threshold_width_css_px"],row["cylinder_width"]["within_1_plus_minus_0_25"],row["cylinder_interior"]["mean_false_crossings_per_100_css_px"]])
            else:
                writer.writerow([row["id"],row["status"],row["technique"],row["theme"],row["rung"],row["dpr"]])
    print(json.dumps({"cells":len(rows),"by_technique":output["by_technique"],"output":str(args.out)},indent=2))


if __name__ == "__main__":
    main()
