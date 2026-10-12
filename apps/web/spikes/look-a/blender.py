"""Generate shared-scene Grease Pencil Line Art targets with Blender 4.5 LTS.

blender --background --factory-startup --python apps/web/spikes/look-a/blender.py --
  --scene work/spikes/look/scene.json --out work/spikes/look/blender-line-art/001
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--rungs", nargs="+", default=["district", "works", "machine"])
    parser.add_argument("--dprs", nargs="+", type=int, default=[1, 2, 3])
    parser.add_argument("--stall-name", default="stall-variant-0-0")
    parser.add_argument("--classification-yaw-epsilon", type=float, default=0)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def from_column_major(values):
    if len(values) != 16:
        raise ValueError("Expected a 16-element column-major matrix")
    return Matrix([[values[col * 4 + row] for col in range(4)] for row in range(4)])


def chunks(values, size):
    return [tuple(values[index : index + size]) for index in range(0, len(values), size)]


def srgb_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def palette_material(index, entry):
    material = bpy.data.materials.new(f"palette_{index}_{entry['name']}")
    material.use_nodes = True
    rgb = tuple(srgb_to_linear(int(entry["day"][offset : offset + 2], 16) / 255) for offset in (1, 3, 5))
    material.diffuse_color = (*rgb, 1)
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (*rgb, 1)
    material.node_tree.links.new(emission.outputs[0], output.inputs["Surface"])
    material["palette_slot"] = index
    material["day"] = entry["day"]
    material["night"] = entry["night"]
    return material


def build_mesh(spec, collection, materials, kit_unit):
    positions = chunks(spec["positions"], 3)
    normals = chunks(spec["normals"], 3)
    surface_ids = spec["surfaceIds"]
    material_slots = spec["materialSlots"]
    if len(positions) % 3 or {len(normals), len(surface_ids), len(material_slots)} != {len(positions)}:
        raise ValueError(f"Invalid triangle attribute lengths: {spec['name']}")

    # Welding supplies adjacency without changing authored surface boundaries.
    # Corner attributes become split glTF vertex attributes during Blender export.
    vertices = []
    vertex_lookup = {}
    corner_indices = []
    max_weld_delta = 0.0
    for position in positions:
        key = tuple(round(component, 7) for component in position)
        if key not in vertex_lookup:
            vertex_lookup[key] = len(vertices)
            vertices.append(position)
        vertex_index = vertex_lookup[key]
        max_weld_delta = max(max_weld_delta, (Vector(position) - Vector(vertices[vertex_index])).length)
        corner_indices.append(vertex_index)
    faces = chunks(corner_indices, 3)
    valid = [index for index, face in enumerate(faces) if len(set(face)) == 3]
    source_corners = [index * 3 + corner for index in valid for corner in range(3)]
    mesh = bpy.data.meshes.new(spec["name"])
    mesh.from_pydata(vertices, [], [faces[index] for index in valid])
    mesh.update()
    for material in materials:
        mesh.materials.append(material)
    for polygon, source_index in zip(mesh.polygons, valid):
        polygon.use_smooth = True
        face_slots = material_slots[source_index * 3 : source_index * 3 + 3]
        if len(set(face_slots)) != 1:
            raise ValueError(f"A triangle crosses palette slots: {spec['name']}")
        polygon.material_index = int(face_slots[0])
    mesh.normals_split_custom_set([normals[index] for index in source_corners])
    for name, values in [("_SURFACE", surface_ids), ("_MAT", material_slots)]:
        attribute = mesh.attributes.new(name=name, type="FLOAT", domain="CORNER")
        attribute.data.foreach_set("value", [values[index] for index in source_corners])
    obj = bpy.data.objects.new(spec["name"], mesh)
    collection.objects.link(obj)
    obj["kit_unit"] = kit_unit
    obj["source_triangles"] = len(faces)
    return obj, {"name": obj.name, "source_triangles": len(faces), "triangles": len(valid), "welded_vertices": len(vertices), "max_weld_delta_world": max_weld_delta}


def build_camera(name, spec, viewport):
    camera_data = bpy.data.cameras.new(name)
    camera = bpy.data.objects.new(name, camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.sensor_fit = "HORIZONTAL"
    camera_data.ortho_scale = spec["right"] - spec["left"]
    camera_data.shift_x = (spec["right"] + spec["left"]) / (2 * camera_data.ortho_scale)
    camera_data.shift_y = (spec["top"] + spec["bottom"]) / (2 * camera_data.ortho_scale)
    camera_data.clip_start = spec["near"]
    camera_data.clip_end = spec["far"]
    camera.matrix_world = from_column_major(spec["matrixWorld"])
    expected_height = camera_data.ortho_scale * viewport["height"] / viewport["width"]
    if abs(expected_height - (spec["top"] - spec["bottom"])) > 1e-5:
        raise ValueError(f"Camera aspect disagrees with viewport: {name}")
    return camera


def verify_projection(camera, spec, viewport, meshes):
    actual = camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(), x=viewport["width"], y=viewport["height"])
    # Keep the three.js reference in float64; converting both sides to Blender's
    # Matrix would conceal its float32 camera representation error.
    expected = np.asarray(spec["projectionMatrix"]).reshape(4, 4).T
    matrix_error = max(abs(actual[row][col] - expected[row][col]) for row in range(4) for col in range(4))
    if matrix_error > 1e-5:
        raise ValueError(f"Blender/three projection mismatch: {matrix_error}")
    actual_view = camera.matrix_world.inverted()
    expected_view = np.linalg.inv(np.asarray(spec["matrixWorld"]).reshape(4, 4).T)
    actual_transform = np.asarray(actual) @ np.asarray(actual_view)
    expected_transform = expected @ expected_view
    pixel_error = 0.0
    count = 0
    for mesh in meshes:
        positions = np.asarray(mesh["positions"]).reshape(-1, 3)
        points = np.column_stack((positions, np.ones(len(positions))))
        three_clip = points @ expected_transform.T
        blender_clip = points @ actual_transform.T
        error = np.abs(three_clip[:, :2] - blender_clip[:, :2]) * np.asarray([viewport["width"], viewport["height"]]) / 2
        pixel_error = max(pixel_error, float(error.max()))
        count += len(positions)
    if pixel_error > 0.001:
        raise ValueError(f"Blender/three vertex projection mismatch: {pixel_error} CSS pixels")
    return {"projection_matrix_max_delta": matrix_error, "sample_count": count, "sample_strategy": "Every supplied triangle vertex; float64 source matrices", "sample_projection_max_error_css_px": pixel_error}


def build_line_art(collection):
    pencil = bpy.data.grease_pencils_v3.new("line_art_target")
    pencil.stroke_depth_order = "3D"
    obj = bpy.data.objects.new("line_art_target", pencil)
    bpy.context.scene.collection.objects.link(obj)
    layer = pencil.layers.new("visible_edges", set_active=True)
    layer.use_lights = False
    layer.frames.new(1)
    ink = bpy.data.materials.new("line_art_black")
    bpy.data.materials.create_gpencil_data(ink)
    ink.grease_pencil.color = (0, 0, 0, 1)
    ink.grease_pencil.show_fill = False
    ink.grease_pencil.show_stroke = True
    pencil.materials.append(ink)
    modifier = obj.modifiers.new("genuine_line_art", "LINEART")
    modifier.source_type = "COLLECTION"
    modifier.source_collection = collection
    modifier.target_layer = layer.name
    modifier.target_material = ink
    modifier.use_contour = True
    modifier.use_crease = True
    modifier.crease_threshold = math.radians(140)
    modifier.use_crease_on_smooth = True
    modifier.use_crease_on_sharp = True
    modifier.use_intersection = True
    modifier.use_material = True
    modifier.use_edge_mark = False
    modifier.use_loose = False
    modifier.use_multiple_levels = False
    modifier.level_start = 0
    modifier.level_end = 0
    modifier.opacity = 1
    modifier.overscan = 0.1
    return obj, modifier


def export_stall(objects, out, name):
    selected = [obj for obj in objects if obj.name == name]
    if len(selected) != 1:
        raise ValueError(f"Expected exactly one stall mesh named {name!r}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    # A scene makes the saved source open as an inspectable asset, rather than an
    # object-only library that looks empty until its datablock is appended.
    asset_scene = bpy.data.scenes.new("standalone_stall")
    for obj in selected:
        asset_scene.collection.objects.link(obj)
    bpy.data.libraries.write(str(out / "stall.blend"), {asset_scene}, fake_user=True)
    bpy.data.scenes.remove(asset_scene)
    bpy.ops.export_scene.gltf(filepath=str(out / "stall.glb"), export_format="GLB", use_selection=True, export_attributes=True, export_extras=True, export_yup=False, export_animations=False)
    binary = (out / "stall.glb").read_bytes()
    chunk_size, chunk_type = struct.unpack_from("<II", binary, 12)
    if chunk_type != 0x4E4F534A:
        raise ValueError("Missing GLB JSON chunk")
    gltf = json.loads(binary[20 : 20 + chunk_size])
    binary_chunk_start = 20 + chunk_size + 8

    def scalar_attribute(accessor_index):
        accessor = gltf["accessors"][accessor_index]
        view = gltf["bufferViews"][accessor["bufferView"]]
        if accessor["componentType"] != 5126 or accessor["type"] != "SCALAR":
            raise ValueError("Custom scalar attributes must retain floating-point values")
        offset = binary_chunk_start + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        stride = view.get("byteStride", 4)
        return [struct.unpack_from("<f", binary, offset + index * stride)[0] for index in range(accessor["count"])]

    primitives = [primitive for mesh in gltf["meshes"] for primitive in mesh["primitives"]]
    attribute_report = []
    for primitive in primitives:
        if not {"_SURFACE", "_MAT"}.issubset(primitive["attributes"]):
            raise ValueError("Blender GLB lost a required custom attribute")
        surfaces = scalar_attribute(primitive["attributes"]["_SURFACE"])
        slots = scalar_attribute(primitive["attributes"]["_MAT"])
        expected_slot = gltf["materials"][primitive["material"]]["extras"]["palette_slot"]
        if set(slots) != {expected_slot} or not all(value >= 1 and value.is_integer() for value in surfaces):
            raise ValueError("Blender GLB changed a palette slot or semantic surface ID")
        attribute_report.append({"vertex_count": len(slots), "palette_slot": expected_slot, "distinct_surface_ids": sorted(set(surfaces))})
    return {"mesh_names": [obj.name for obj in selected], "glb_primitives_with_attributes": len(primitives), "attribute_values": attribute_report, "coordinate_system": "Shared Y-up coordinates retained; export_yup=False prevents a second axis conversion", "authoring_limit": "The Blender script materializes shared triangle data; the independent parametric route is measured separately by blender_stall.py"}


def main():
    started = time.monotonic()
    args = arguments()
    args.out.mkdir(parents=True, exist_ok=True)
    source_bytes = args.scene.read_bytes()
    data = json.loads(source_bytes)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.world = bpy.data.worlds.new("white_line_target_background")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1
    scene.frame_set(1)
    collection = bpy.data.collections.new("shared_scene_geometry")
    scene.collection.children.link(collection)
    materials = [palette_material(index, entry) for index, entry in enumerate(data["palette"])]
    objects = []
    geometry_report = []
    for mesh in data["meshes"]:
        obj, report = build_mesh(mesh, collection, materials, data["kitUnit"])
        objects.append(obj)
        geometry_report.append(report)
    export_report = export_stall(objects, args.out, args.stall_name)
    # White faces preserve occlusion while isolating the black line layer. Export
    # happens first, so the standalone stall retains the authored palette values.
    for material in materials:
        material.node_tree.nodes["Emission"].inputs["Color"].default_value = (1, 1, 1, 1)
    viewport = data["viewport"]
    cameras = {name: build_camera(name, spec, viewport) for name, spec in data["cameras"].items()}
    bpy.context.view_layer.update()
    report = {"blender": bpy.app.version_string, "input_sha256": hashlib.sha256(source_bytes).hexdigest(), "technique": "Grease Pencil LINEART modifier, EEVEE Next", "input_geometry": geometry_report, "stall_export": export_report, "targets": [], "approval": "pending; technical targets only"}
    previous_line_object = None
    for rung in args.rungs:
        scene.camera = cameras[rung]
        projection = verify_projection(scene.camera, data["cameras"][rung], viewport, data["meshes"])
        for obj in objects:
            obj.hide_render = False
        if previous_line_object:
            previous_line_object.hide_render = True
        line_object, line_art = build_line_art(collection)
        line_object.name = f"line_art_{rung}"
        classification_delta = 0.0
        if args.classification_yaw_epsilon:
            # At exact 45-degree yaw Blender 4.5 rejects cylinder tangent edges
            # whose opposite face-dot products sum to exactly zero. A separately
            # recorded classification camera resolves that degeneracy; the render
            # camera and all rendered world-space stroke coordinates stay unchanged.
            classifier = scene.camera.copy()
            classifier.data = scene.camera.data.copy()
            classifier.name = f"line_art_classifier_{rung}"
            scene.collection.objects.link(classifier)
            classifier.matrix_world = scene.camera.matrix_world @ Matrix.Rotation(args.classification_yaw_epsilon, 4, "Y")
            line_art.use_custom_camera = True
            line_art.source_camera = classifier
            projection_matrix = from_column_major(data["cameras"][rung]["projectionMatrix"])
            original_view = scene.camera.matrix_world.inverted()
            classification_view = classifier.matrix_world.inverted()
            for mesh in data["meshes"]:
                for position in chunks(mesh["positions"], 3):
                    point = Vector((*position, 1))
                    original = projection_matrix @ original_view @ point
                    classified = projection_matrix @ classification_view @ point
                    classification_delta = max(classification_delta, abs(original.x - classified.x) * viewport["width"] / 2, abs(original.y - classified.y) * viewport["height"] / 2)
        # Blender 4.5's Line Art generator stores its radius parameter / 2 in the
        # point-radius attribute (lineart_cpu.cc). Its misleadingly named parameter
        # therefore receives one CSS pixel's diameter, not the intended half-radius.
        diameter = scene.camera.data.ortho_scale / viewport["width"]
        line_art.radius = diameter
        line_art.stroke_depth_offset = 0
        # Baking keeps Line Art's solved visibility while removing coplanar depth
        # competition from the white source faces in EEVEE's stroke rasterization.
        bpy.context.view_layer.objects.active = line_object
        bpy.ops.object.select_all(action="DESELECT")
        line_object.select_set(True)
        bpy.context.view_layer.update()
        bpy.ops.object.modifier_apply(modifier=line_art.name)
        drawing = line_object.data.layers[0].frames[0].drawing
        stroke_count = len(drawing.strokes)
        if stroke_count == 0:
            raise ValueError(f"Line Art generated no visible strokes for {rung}")
        point_radii = [item.value for item in drawing.attributes["radius"].data]
        for obj in objects:
            obj.hide_render = True
        for dpr in args.dprs:
            scene.render.resolution_x = viewport["width"] * dpr
            scene.render.resolution_y = viewport["height"] * dpr
            scene.render.filepath = str(args.out / f"line-art-{rung}-dpr-{dpr}.png")
            begin = time.monotonic()
            bpy.context.view_layer.update()
            bpy.ops.render.render(write_still=True)
            report["targets"].append({"rung": rung, "dpr": dpr, "width": scene.render.resolution_x, "height": scene.render.resolution_y, "line_art_radius_parameter_world": diameter, "point_radius_world_min": min(point_radii), "point_radius_world_max": max(point_radii), "generated_strokes": stroke_count, "classification_yaw_epsilon_radians": args.classification_yaw_epsilon, "classification_projection_max_delta_css_px": classification_delta, "seconds": time.monotonic() - begin, "file": scene.render.filepath, **projection})
        previous_line_object = line_object
    bpy.ops.wm.save_as_mainfile(filepath=str(args.out / "line-art-scene.blend"))
    report["elapsed_seconds"] = time.monotonic() - started
    (args.out / "render-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
