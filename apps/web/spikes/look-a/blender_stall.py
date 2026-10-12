"""Independently construct all three stall variants in Blender from parameters.

Scene triangles are used only after authoring for geometric parity measurements.
"""

import argparse
import json
import math
from pathlib import Path
import sys
import time

import bpy
from mathutils import Vector, kdtree

sys.path.insert(0, str(Path(__file__).parent))
sys.dont_write_bytecode = True
from blender import build_mesh, export_stall, palette_material


class StallGeometry:
    def __init__(self, palette):
        self.palette = {entry["name"]: index for index, entry in enumerate(palette)}
        self.positions = []
        self.normals = []
        self.surfaces = []
        self.materials = []
        self.next_surface = 1

    def triangle(self, vertices, normals, surface, material):
        for vertex, normal in zip(vertices, normals):
            self.positions.extend(vertex)
            self.normals.extend(normal)
            self.surfaces.append(surface)
            self.materials.append(self.palette[material])

    def box(self, width, height, depth, x, y, z, material="tone-1"):
        xmin, xmax = x - width / 2, x + width / 2
        ymin, ymax = y - height / 2, y + height / 2
        zmin, zmax = z - depth / 2, z + depth / 2
        faces = [
            ([(xmax, ymin, zmax), (xmax, ymin, zmin), (xmax, ymax, zmin), (xmax, ymax, zmax)], (1, 0, 0)),
            ([(xmin, ymin, zmin), (xmin, ymin, zmax), (xmin, ymax, zmax), (xmin, ymax, zmin)], (-1, 0, 0)),
            ([(xmin, ymax, zmax), (xmax, ymax, zmax), (xmax, ymax, zmin), (xmin, ymax, zmin)], (0, 1, 0)),
            ([(xmin, ymin, zmin), (xmax, ymin, zmin), (xmax, ymin, zmax), (xmin, ymin, zmax)], (0, -1, 0)),
            ([(xmin, ymin, zmax), (xmax, ymin, zmax), (xmax, ymax, zmax), (xmin, ymax, zmax)], (0, 0, 1)),
            ([(xmax, ymin, zmin), (xmin, ymin, zmin), (xmin, ymax, zmin), (xmax, ymax, zmin)], (0, 0, -1)),
        ]
        for vertices, normal in faces:
            for indices in [(0, 1, 2), (0, 2, 3)]:
                self.triangle([vertices[index] for index in indices], [normal] * 3, self.next_surface, material)
            self.next_surface += 1

    def cylinder(self, radius, height, x, y, z, material="steel"):
        count = 24
        for index in range(count):
            a, b = index * math.tau / count, (index + 1) * math.tau / count
            na, nb = (math.sin(a), 0, math.cos(a)), (math.sin(b), 0, math.cos(b))
            lower_a = (x + radius * na[0], y - height / 2, z + radius * na[2])
            lower_b = (x + radius * nb[0], y - height / 2, z + radius * nb[2])
            upper_a = (lower_a[0], y + height / 2, lower_a[2])
            upper_b = (lower_b[0], y + height / 2, lower_b[2])
            self.triangle([lower_a, lower_b, upper_b], [na, nb, nb], self.next_surface, material)
            self.triangle([lower_a, upper_b, upper_a], [na, nb, na], self.next_surface, material)
            self.triangle([(x, y + height / 2, z), upper_a, upper_b], [(0, 1, 0)] * 3, self.next_surface + 1, material)
            self.triangle([(x, y - height / 2, z), lower_b, lower_a], [(0, -1, 0)] * 3, self.next_surface + 2, material)
        self.next_surface += 3

    def spec(self, name):
        return {"name": name, "positions": self.positions, "normals": self.normals, "surfaceIds": self.surfaces, "materialSlots": self.materials}


def author_stall(parameters, palette, variant):
    result = StallGeometry(palette)
    width, depth, post_height = parameters["width"], parameters["depth"], parameters["postHeight"]
    result.box(width, .25, depth, 0, .125, 0)
    result.box(width, .65, .35, 0, .7, depth / 2 - .15)
    result.box(width + .2, .13, depth + .3, 0, post_height + .15, 0)
    for x in [-width / 2 + .2, width / 2 - .2]:
        for z in [-depth / 2 + .2, depth / 2 - .2]:
            result.box(.12, post_height, .12, x, post_height / 2 + .1, z)
    result.box(1.4, .28, .08, 0, post_height - .15, depth / 2 + .06, "steel")
    if variant == 0:
        result.cylinder(.42, .65, -.55, 1.1, 0)
    elif variant == 1:
        for x in [-.6, 0, .6]:
            result.box(.42, .55, .55, x, 1.03, -.1)
    elif variant == 2:
        result.box(1.7, .55, .6, 0, 1.03, -.1)
        result.cylinder(.24, .5, .6, 1.55, -.1)
    else:
        raise ValueError(f"Unsupported stand-in stall variant: {variant}")
    return result.spec(f"independent-stall-{variant}")


def points(values):
    return [Vector(values[index : index + 3]) for index in range(0, len(values), 3)]


def compare_geometry(authored, reference):
    generated = points(authored["positions"])
    observed = points(reference["positions"])
    generated_min = Vector([min(point[axis] for point in generated) for axis in range(3)])
    observed_min = Vector([min(point[axis] for point in observed) for axis in range(3)])
    translation = observed_min - generated_min
    aligned = [point + translation for point in generated]
    maximum = 0.0
    for source, target in [(aligned, observed), (observed, aligned)]:
        tree = kdtree.KDTree(len(target))
        for index, point in enumerate(target):
            tree.insert(point, index)
        tree.balance()
        maximum = max(maximum, max(tree.find(point)[2] for point in source))
    threshold = 0.000002
    if maximum > threshold or len(generated) != len(observed):
        raise ValueError(f"Independent stall shape differs: {maximum}; vertices {len(generated)} vs {len(observed)}")
    return {"source_mesh": reference["name"], "alignment_translation_world": list(translation), "bidirectional_vertex_set_max_distance_world": maximum, "threshold_world": threshold, "triangle_count": len(generated) // 3, "source_triangle_count": len(observed) // 3, "limitation": "Vertex-set and triangle-count parity permits different triangulation diagonals. It does not prove topology, normals or semantic surface-ID equality."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    data = json.loads(args.scene.read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    collection = bpy.data.collections.new("independent_parametric_stalls")
    scene.collection.children.link(collection)
    materials = [palette_material(index, entry) for index, entry in enumerate(data["palette"])]
    reports = []
    for variant in range(data["stallParameters"]["variants"]):
        begin = time.perf_counter()
        spec = author_stall(data["stallParameters"], data["palette"], variant)
        obj, geometry = build_mesh(spec, collection, materials, data["kitUnit"])
        author_seconds = time.perf_counter() - begin
        reference = next(mesh for mesh in data["meshes"] if mesh["name"] == f"stall-variant-{variant}-0")
        parity = compare_geometry(spec, reference)
        destination = args.out / f"variant-{variant}"
        destination.mkdir(exist_ok=True)
        begin_export = time.perf_counter()
        exported = export_stall([obj], destination, obj.name)
        exported["authoring_limit"] = "Independent Python parameter-to-mesh generation; shared helpers only serialize meshes/material attributes and glTF. Agent time is not per-asset modelling time."
        reports.append({"variant": variant, "author_and_mesh_seconds": author_seconds, "export_seconds": time.perf_counter() - begin_export, "geometry": geometry, "parity": parity, "export": exported})
    (args.out / "independent-stall-report.json").write_text(json.dumps({"blender": bpy.app.version_string, "parameters": data["stallParameters"], "route": "Independent mathematical box/cylinder authoring in Blender Python", "variants": reports, "approval": "pending"}, indent=2) + "\n")
    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    main()
