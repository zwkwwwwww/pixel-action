"""Inspect art-source/blender/hero.blend and print a JSON summary.

Run:  blender -b art-source/blender/hero.blend -P tools/blender/inspect_blend.py
Prints one line:  BLEND_INFO {json}
"""
import bpy
import json

info = {"file": bpy.data.filepath}

info["engine"] = bpy.context.scene.render.engine
info["resolution"] = [
    bpy.context.scene.render.resolution_x,
    bpy.context.scene.render.resolution_y,
]
info["film_transparent"] = bpy.context.scene.render.film_transparent
info["view_transform"] = bpy.context.scene.view_settings.view_transform

arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
info["armatures"] = []
for a in arms:
    info["armatures"].append(
        {
            "name": a.name,
            "bones": [b.name for b in a.data.bones],
            "actions_linked": [
                a.animation_data.action.name
                if a.animation_data and a.animation_data.action
                else None
            ],
            "nla_tracks": [t.name for t in a.animation_data.nla_tracks]
            if a.animation_data
            else [],
        }
    )

info["actions"] = []
for act in bpy.data.actions:
    info["actions"].append(
        {
            "name": act.name,
            "frame_range": list(act.frame_range),
            "fcurves": len(act.fcurves) if hasattr(act, "fcurves") else None,
            "fps": act.get("fps"),
            "loop": act.get("loop"),
            "frame_count": act.get("frame_count"),
        }
    )

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
info["meshes"] = []
for m in meshes:
    info["meshes"].append(
        {
            "name": m.name,
            "verts": len(m.data.vertices),
            "polys": len(m.data.polygons),
            "materials": [ms.name for ms in m.data.materials],
            "vgroups": len(m.vertex_groups),
            "modifiers": [mo.type for mo in m.modifiers],
        }
    )

cams = [o for o in bpy.data.objects if o.type == "CAMERA"]
info["cameras"] = [
    {
        "name": c.name,
        "type": c.data.type,
        "ortho_scale": c.data.ortho_scale,
        "location": list(c.location),
    }
    for c in cams
]

print("BLEND_INFO " + json.dumps(info))
