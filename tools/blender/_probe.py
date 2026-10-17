import bpy, bmesh, sys, json
from mathutils import Vector, Matrix, Euler

out = {}
out["version"] = bpy.app.version_string
props = bpy.types.RenderSettings.bl_rna.properties["engine"]
out["engines"] = [e.identifier for e in props.enum_items]

try:
    import numpy as np
    out["numpy"] = np.__version__
except Exception as e:
    out["numpy"] = "ERR " + str(e)

try:
    import PIL
    out["PIL"] = PIL.__version__
except Exception as e:
    out["PIL"] = "ERR " + str(e)

# bmesh icosphere signature
try:
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.1)
    out["icosphere"] = "radius ok verts=%d" % len(bm.verts)
    bm.free()
except Exception as e:
    out["icosphere"] = "ERR " + str(e)
    try:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.1, matrix=Matrix.Identity(4))
        out["icosphere2"] = "ok"
    except Exception as e2:
        out["icosphere2"] = "ERR " + str(e2)

# action slots
a = bpy.data.actions.new("probe")
out["action_has_slots"] = hasattr(a, "slots")
out["action_attrs"] = [x for x in dir(a) if "slot" in x.lower()]
# nla strip slots
arm_data = bpy.data.armatures.new("A")
arm = bpy.data.objects.new("A", arm_data)
bpy.context.collection.objects.link(arm)
ad = arm.animation_data_create()
out["ad_attrs"] = [x for x in dir(ad) if "slot" in x.lower()]
out["nla_strip_has_slot"] = "action_slot" in dir(bpy.types.NlaStrip)

# world / colorspace of loaded image
out["scene_unit"] = bpy.context.scene.unit_settings.system

print("PROBE_JSON " + json.dumps(out))
