"""Build the low-poly heroine for the pixel-action Blender pipeline.

Run (from the project root):
    blender -b --factory-startup -P tools/blender/build_hero.py

Output:
    art-source/blender/hero.blend   (mesh + 9 bones + 9 actions + camera/lights)

Design contract: docs/art-contract.md
  - 1.70 units tall, feet on z=0, faces +X
  - flat-colour materials only (skin / coat / pants / metal / hair / leather)
  - bones: root hips spine head armL armR legL legR weapon
  - actions: idle walk attack1 attack2 attack3 dodge hurt death special
"""
from __future__ import annotations

import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_BLEND = os.path.join(ROOT, "art-source", "blender", "hero.blend")

# ----------------------------------------------------------------------------
# scene reset
# ----------------------------------------------------------------------------
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.cameras, bpy.data.lights):
    for item in list(coll):
        if item.users == 0:
            coll.remove(item)

SCENE = bpy.context.scene
COLL = SCENE.collection
PARTS: list[bpy.types.Object] = []


# ----------------------------------------------------------------------------
# materials (flat colours, no textures)
# ----------------------------------------------------------------------------
def mat(name, rgb, rough=0.72, metal=0.0, spec=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = spec
            break
    m.diffuse_color = (*rgb, 1.0)
    return m


M_SKIN = mat("skin", (0.94, 0.72, 0.58), rough=0.62, spec=0.30)
M_HAIR = mat("hair", (0.46, 0.09, 0.12), rough=0.55, spec=0.40)
M_COAT = mat("coat", (0.11, 0.19, 0.34), rough=0.80, spec=0.25)
M_COAT_DARK = mat("coat_dark", (0.07, 0.12, 0.23), rough=0.82, spec=0.22)
M_TRIM = mat("trim", (0.78, 0.60, 0.22), rough=0.38, metal=0.75, spec=0.5)
M_PANTS = mat("pants", (0.15, 0.14, 0.17), rough=0.85, spec=0.20)
M_BOOT = mat("boot", (0.24, 0.14, 0.10), rough=0.70, spec=0.30)
M_LEATHER = mat("leather", (0.31, 0.19, 0.12), rough=0.68, spec=0.30)
M_METAL = mat("metal", (0.72, 0.76, 0.82), rough=0.30, metal=0.95, spec=0.6)


# ----------------------------------------------------------------------------
# mesh helpers
# ----------------------------------------------------------------------------
def _finish(name, me, material, bone, smooth=False):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    if material is not None:
        me.materials.append(material)
    if bone:
        vg = ob.vertex_groups.new(name=bone)
        vg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    PARTS.append(ob)
    return ob


def mesh_obj(name, verts, faces, material, bone, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(verbose=False)
    return _finish(name, me, material, bone, smooth)


def taper_box(name, c0, c1, w0, d0, w1, d1, material, bone):
    """Box from bottom centre c0 to top centre c1. w = Y width, d = X depth."""
    x0, y0, z0 = c0
    x1, y1, z1 = c1
    v = [
        (x0 - d0 / 2, y0 - w0 / 2, z0),
        (x0 + d0 / 2, y0 - w0 / 2, z0),
        (x0 + d0 / 2, y0 + w0 / 2, z0),
        (x0 - d0 / 2, y0 + w0 / 2, z0),
        (x1 - d1 / 2, y1 - w1 / 2, z1),
        (x1 + d1 / 2, y1 - w1 / 2, z1),
        (x1 + d1 / 2, y1 + w1 / 2, z1),
        (x1 - d1 / 2, y1 + w1 / 2, z1),
    ]
    f = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return mesh_obj(name, v, f, material, bone)


def tube(name, p0, p1, r0, r1, sides, material, bone, phase=0.0):
    p0 = Vector(p0)
    p1 = Vector(p1)
    axis = (p1 - p0).normalized()
    ref = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u).normalized()
    verts = []
    for centre, radius in ((p0, r0), (p1, r1)):
        for i in range(sides):
            a = 2 * math.pi * i / sides + phase
            d = u * math.cos(a) + v * math.sin(a)
            verts.append(tuple(centre + d * radius))
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, 2 * sides)))
    return mesh_obj(name, verts, faces, material, bone)


def ico(name, centre, radius, scale, material, bone, subdiv=1, smooth=False):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(centre), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return _finish(name, me, material, bone, smooth)


def box_frame(name, centre, u, v, n, hu, hv, hn, material, bone):
    centre = Vector(centre)
    pts = []
    for su in (-1, 1):
        for sv in (-1, 1):
            for sn in (-1, 1):
                pts.append(tuple(centre + u * (hu * su) + v * (hv * sv) + n * (hn * sn)))
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return mesh_obj(name, pts, faces, material, bone)


# ----------------------------------------------------------------------------
# body (facing +X, Y is the width axis, feet at z=0)
# ----------------------------------------------------------------------------
# head + hair ---------------------------------------------------------------
ico("head", (0.006, 0.0, 1.588), 0.098, (1.02, 0.94, 1.05), M_SKIN, "head", subdiv=2)
ico("hair_cap", (-0.042, 0.0, 1.598), 0.108, (1.06, 1.03, 0.95), M_HAIR, "head", subdiv=2)
taper_box("bangs", (0.055, 0.0, 1.622), (0.03, 0.0, 1.672), 0.155, 0.085, 0.115, 0.075, M_HAIR, "head")
# twin tails: swept back (-X) and out, so the silhouette reads from the side
for side, tag in ((-1, "R"), (1, "L")):
    y = 0.092 * side
    root = (-0.02, y, 1.628)
    mid = (-0.135, 0.152 * side, 1.548)
    end = (-0.255, 0.182 * side, 1.415)
    tube(f"pigtail{tag}_a", root, mid, 0.048, 0.038, 6, M_HAIR, "head")
    tube(f"pigtail{tag}_b", mid, end, 0.038, 0.013, 6, M_HAIR, "head")
    ico(f"hair_tie{tag}", root, 0.036, (0.9, 0.9, 0.9), M_TRIM, "head", subdiv=1)

# neck ----------------------------------------------------------------------
tube("neck", (-0.004, 0.0, 1.425), (-0.004, 0.0, 1.50), 0.045, 0.042, 6, M_SKIN, "spine")

# torso ---------------------------------------------------------------------
taper_box("pelvis", (0.0, 0.0, 0.86), (0.0, 0.0, 1.018), 0.238, 0.176, 0.222, 0.166, M_COAT, "hips")
taper_box("waist", (0.0, 0.0, 1.018), (0.0, 0.0, 1.20), 0.216, 0.162, 0.262, 0.184, M_COAT, "spine")
taper_box("chest", (0.0, 0.0, 1.20), (0.0, 0.0, 1.415), 0.262, 0.184, 0.322, 0.174, M_COAT, "spine")
for side in (-1, 1):
    ico("bust_%d" % side, (0.074, 0.058 * side, 1.283), 0.050, (1.30, 0.92, 0.74), M_COAT, "spine", subdiv=1)
    ico("shoulder_%d" % side, (0.0, 0.157 * side, 1.392), 0.056, (1.0, 1.06, 0.86), M_COAT, "spine", subdiv=1)

# belt + coat tail ----------------------------------------------------------
taper_box("belt", (0.0, 0.0, 0.996), (0.0, 0.0, 1.058), 0.236, 0.186, 0.236, 0.186, M_LEATHER, "hips")
box_frame("buckle", (0.094, 0.0, 1.027), Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)),
          0.012, 0.030, 0.024, M_TRIM, "hips")
taper_box("coat_tail", (-0.085, 0.0, 0.965), (-0.145, 0.0, 0.715), 0.268, 0.105, 0.330, 0.075,
          M_COAT_DARK, "hips")
taper_box("coat_tail_trim", (-0.143, 0.0, 0.723), (-0.152, 0.0, 0.700), 0.326, 0.078, 0.336, 0.070,
          M_TRIM, "hips")
# short side skirts so the hips read as a coat, legs still visible in front
for side in (-1, 1):
    taper_box("skirt_%d" % side, (0.0, 0.118 * side, 0.955), (0.0, 0.128 * side, 0.805),
              0.052, 0.225, 0.058, 0.245, M_COAT_DARK, "hips")

# arms ----------------------------------------------------------------------
for side, tag, bone in ((-1, "R", "armR"), (1, "L", "armL")):
    sh = (0.0, 0.168 * side, 1.392)
    el = (0.008, 0.205 * side, 1.205)
    wr = (0.020, 0.215 * side, 1.035)
    tube(f"upperarm{tag}", sh, el, 0.055, 0.043, 6, M_COAT, bone)
    tube(f"forearm{tag}", el, wr, 0.043, 0.034, 6, M_SKIN, bone)
    ico(f"hand{tag}", (0.026, 0.216 * side, 0.996), 0.044, (1.10, 0.92, 1.0), M_LEATHER, bone, subdiv=1)
# right arm: metal bracer + pauldron (sword arm, camera side)
tube("bracerR", (0.012, -0.207, 1.145), (0.020, -0.215, 1.055), 0.053, 0.046, 6, M_METAL, "armR")
ico("pauldronR", (0.0, -0.183, 1.418), 0.092, (1.0, 1.16, 0.60), M_METAL, "armR", subdiv=2)
ico("pauldronR2", (0.0, -0.196, 1.372), 0.070, (1.0, 1.18, 0.52), M_METAL, "armR", subdiv=1)
# left arm: leather cuff
tube("cuffL", (0.012, 0.207, 1.135), (0.020, 0.215, 1.075), 0.048, 0.043, 6, M_LEATHER, "armL")

# legs ----------------------------------------------------------------------
for side, tag, bone in ((-1, "R", "legR"), (1, "L", "legL")):
    hip = (0.0, 0.088 * side, 0.905)
    knee = (0.006, 0.095 * side, 0.478)
    ankle = (0.014, 0.095 * side, 0.118)
    tube(f"thigh{tag}", hip, knee, 0.078, 0.055, 6, M_PANTS, bone)
    tube(f"shin{tag}", knee, ankle, 0.055, 0.040, 6, M_PANTS, bone)
    taper_box(f"boot{tag}", (0.044, 0.095 * side, 0.0), (0.018, 0.095 * side, 0.132),
              0.098, 0.205, 0.092, 0.140, M_BOOT, bone)
    taper_box(f"bootcuff{tag}", (0.014, 0.095 * side, 0.126), (0.012, 0.095 * side, 0.215),
              0.096, 0.118, 0.108, 0.108, M_BOOT, bone)

# ----------------------------------------------------------------------------
# sword  (built in the rest pose, blade pointing down-forward from the hand)
# ----------------------------------------------------------------------------
HAND = Vector((0.026, -0.216, 0.996))
U = Vector((0.820, 0.0, -0.572)).normalized()   # blade axis, rest pose
V = Vector((0.0, 1.0, 0.0))                     # across the blade
N = U.cross(V).normalized()                     # blade flat normal

tube("grip", tuple(HAND - U * 0.115), tuple(HAND + U * 0.012), 0.021, 0.019, 6, M_LEATHER, "weapon")
ico("pommel", tuple(HAND - U * 0.132), 0.030, (1.0, 1.0, 2.6), M_METAL, "weapon", subdiv=1)
box_frame("guard", HAND + U * 0.024, U, V, N, 0.016, 0.088, 0.023, M_TRIM, "weapon")

sections = [
    (0.040, 0.030, 0.0075),
    (0.330, 0.028, 0.0068),
    (0.610, 0.022, 0.0052),
    (0.790, 0.011, 0.0032),
]
verts = []
faces = []
for t, hw, ht in sections:
    c = HAND + U * t
    verts += [tuple(c + V * hw), tuple(c + N * ht), tuple(c - V * hw), tuple(c - N * ht)]
tip_index = len(verts)
verts.append(tuple(HAND + U * 0.862))
for r in range(len(sections) - 1):
    a = r * 4
    b = (r + 1) * 4
    for k in range(4):
        k2 = (k + 1) % 4
        faces.append((a + k, a + k2, b + k2, b + k))
faces.append((0, 1, 2, 3))
last = (len(sections) - 1) * 4
for k in range(4):
    faces.append((last + k, last + (k + 1) % 4, tip_index))
mesh_obj("blade", verts, faces, M_METAL, "weapon")

# ----------------------------------------------------------------------------
# armature
# ----------------------------------------------------------------------------
arm_data = bpy.data.armatures.new("HeroRig")
ARM = bpy.data.objects.new("HeroRig", arm_data)
COLL.objects.link(ARM)
bpy.context.view_layer.objects.active = ARM
ARM.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None, connect=False, deform=True):
    b = eb.new(name)
    b.head = Vector(head)
    b.tail = Vector(tail)
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    b.use_deform = deform
    return b


bone("root", (0, 0, 0), (0, 0, 0.18), deform=False)
bone("hips", (0, 0, 0.905), (0, 0, 1.03), "root")
bone("spine", (0, 0, 1.03), (0, 0, 1.43), "hips", connect=True)
bone("head", (0, 0, 1.43), (0, 0, 1.71), "spine", connect=True)
bone("armR", (0, -0.168, 1.392), (0.020, -0.215, 1.035), "spine")
bone("armL", (0, 0.168, 1.392), (0.020, 0.215, 1.035), "spine")
bone("legR", (0, -0.088, 0.905), (0.014, -0.095, 0.118), "hips")
bone("legL", (0, 0.088, 0.905), (0.014, 0.095, 0.118), "hips")
bone("weapon", tuple(HAND), tuple(HAND + U * 0.45), "armR")
bpy.ops.object.mode_set(mode="OBJECT")
ARM.show_in_front = True
arm_data.display_type = "OCTAHEDRAL"

# ----------------------------------------------------------------------------
# join parts, bind to armature
# ----------------------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
for ob in PARTS:
    ob.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
bpy.ops.object.join()
HERO = bpy.context.view_layer.objects.active
HERO.name = "HeroMesh"
HERO.data.name = "HeroMesh"
HERO.parent = ARM
HERO.matrix_parent_inverse = Matrix.Identity(4)
mod = HERO.modifiers.new("Armature", "ARMATURE")
mod.object = ARM
mod.use_vertex_groups = True

# ----------------------------------------------------------------------------
# animation helpers
# ----------------------------------------------------------------------------
for pb in ARM.pose.bones:
    pb.rotation_mode = "QUATERNION"


def reset_pose():
    for pb in ARM.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def apply_pose(pose):
    reset_pose()
    for name, spec in pose.items():
        pb = ARM.pose.bones[name]
        rx = spec.get("rx", 0.0)
        ry = spec.get("ry", 0.0)
        rz = spec.get("rz", 0.0)
        tx = spec.get("tx", 0.0)
        ty = spec.get("ty", 0.0)
        tz = spec.get("tz", 0.0)
        M = pb.bone.matrix_local.to_3x3()
        if rx or ry or rz:
            R = (
                Matrix.Rotation(math.radians(rz), 3, "Z")
                @ Matrix.Rotation(math.radians(ry), 3, "Y")
                @ Matrix.Rotation(math.radians(rx), 3, "X")
            )
            pb.rotation_quaternion = (M.inverted() @ R @ M).to_quaternion()
        if tx or ty or tz:
            pb.location = M.inverted() @ Vector((tx, ty, tz))


BASE = {
    "spine": {"ry": 3.0},
    "head": {"ry": -3.0},
    "armR": {"ry": -8.0, "rx": -7.0},
    "armL": {"ry": 8.0, "rx": 7.0},
    "legR": {"ry": 3.0},
    "legL": {"ry": -3.0},
    "weapon": {"ry": 0.0},
}


def pose(**over):
    """BASE + additive world-axis overrides: pose(spine=dict(ry=10), ...)"""
    out = {k: dict(v) for k, v in BASE.items()}
    for bone_name, spec in over.items():
        dst = out.setdefault(bone_name, {})
        for key, value in spec.items():
            dst[key] = dst.get(key, 0.0) + value
    return out


# --- clip definitions -------------------------------------------------------
# rotations are in degrees around WORLD axes (X = side lean, Y = pitch forward,
# Z = yaw). translations are world-space metres. See README.
def clip_idle():
    return [
        pose(),
        pose(hips={"tz": 0.012}, spine={"ry": 1.5}, head={"ry": -1.5},
             armR={"ry": -2}, armL={"ry": 2}),
        pose(hips={"tz": 0.004}, spine={"ry": 2.5}, head={"ry": -2.5},
             armR={"ry": -3}, armL={"ry": 3}, weapon={"ry": 2}),
        pose(hips={"tz": -0.004}, spine={"ry": 0.5}, head={"ry": -0.5},
             armR={"ry": 2}, armL={"ry": -2}, weapon={"ry": -1}),
    ]


def clip_walk():
    return [
        pose(hips={"tz": -0.015, "ty": 0.010}, spine={"ry": 6, "rz": 6},
             head={"ry": -5, "rz": -4}, legR={"ry": -26}, legL={"ry": 22},
             armR={"ry": 18}, armL={"ry": -16}, weapon={"ry": 4}),
        pose(hips={"tz": 0.008}, spine={"ry": 4, "rz": 2}, head={"ry": -3, "rz": -2},
             legR={"ry": -12}, legL={"ry": 10}, armR={"ry": 6}, armL={"ry": -6}),
        pose(hips={"tz": -0.005}, spine={"ry": 4, "rz": -2}, head={"ry": -3},
             legR={"ry": 6}, legL={"ry": -6}, armR={"ry": -4}, armL={"ry": 4}),
        pose(hips={"tz": -0.015, "ty": -0.010}, spine={"ry": 6, "rz": -6},
             head={"ry": -5, "rz": 4}, legR={"ry": 22}, legL={"ry": -26},
             armR={"ry": -16}, armL={"ry": 18}, weapon={"ry": -4}),
        pose(hips={"tz": 0.008}, spine={"ry": 4, "rz": -2}, head={"ry": -3, "rz": 2},
             legR={"ry": 10}, legL={"ry": -12}, armR={"ry": -6}, armL={"ry": 6}),
        pose(hips={"tz": -0.005}, spine={"ry": 4, "rz": 2}, head={"ry": -3},
             legR={"ry": -6}, legL={"ry": 6}, armR={"ry": 4}, armL={"ry": -4}),
    ]


def clip_attack1():
    # wide horizontal cut: torso yaw winds up, arm sweeps, blade stays ~level
    return [
        pose(hips={"tz": -0.02, "rz": -8}, spine={"ry": -2, "rz": -28},
             head={"rz": -12}, armR={"ry": -35, "rx": -22}, armL={"ry": 22},
             legR={"ry": -8}, legL={"ry": 8}, weapon={"ry": 10}),
        pose(hips={"tz": -0.01, "rz": 2}, spine={"ry": 4, "rz": 4}, head={"rz": 4},
             armR={"ry": -76, "rx": -10}, armL={"ry": -8}, weapon={"ry": 26}),
        pose(hips={"tz": -0.02, "rz": 14, "tx": 0.05}, spine={"ry": 9, "rz": 30},
             head={"rz": 10, "ry": -4}, armR={"ry": -24, "rx": 2}, armL={"ry": -30},
             legR={"ry": 10}, legL={"ry": -12}, weapon={"ry": 16}),
        pose(hips={"tz": -0.006, "rz": 4}, spine={"ry": 5, "rz": 10}, head={"rz": 2},
             armR={"ry": 4}, armL={"ry": -6}, weapon={"ry": 2}),
    ]


def clip_attack2():
    # backhand: starts across the body, whips outward and up
    return [
        pose(hips={"tz": -0.02, "rz": 10}, spine={"ry": 2, "rz": 26},
             head={"rz": 10}, armR={"ry": -78, "rx": 30}, armL={"ry": -20},
             weapon={"ry": 34}),
        pose(hips={"tz": -0.008, "rz": 2}, spine={"ry": 4, "rz": 4}, head={"rz": 4},
             armR={"ry": -46, "rx": 8}, armL={"ry": 10}, weapon={"ry": 12}),
        pose(hips={"tz": -0.015, "rz": -14, "tx": 0.04}, spine={"ry": 6, "rz": -28},
             head={"rz": -12}, armR={"ry": 22, "rx": -26}, armL={"ry": 34},
             legR={"ry": -10}, legL={"ry": 12}, weapon={"ry": -22}),
        pose(hips={"tz": -0.006, "rz": -4}, spine={"ry": 4, "rz": -8}, head={"rz": -2},
             armR={"ry": 8}, armL={"ry": 8}, weapon={"ry": -4}),
    ]


def clip_attack3():
    # rising uppercut: coil low, drive the blade from the floor to overhead
    return [
        pose(hips={"tz": -0.10}, spine={"ry": 18}, head={"ry": -8},
             legR={"ry": -20}, legL={"ry": 15}, armR={"ry": 25}, armL={"ry": -18},
             weapon={"ry": 30}),
        pose(hips={"tz": -0.14}, spine={"ry": 24}, head={"ry": -10},
             legR={"ry": -24}, legL={"ry": 18}, armR={"ry": 38}, armL={"ry": -26},
             weapon={"ry": 44}),
        pose(hips={"tz": -0.02}, spine={"ry": -4}, head={"ry": 2},
             legR={"ry": -6}, legL={"ry": 6}, armR={"ry": -62}, armL={"ry": 30},
             weapon={"ry": -6}),
        pose(hips={"tz": 0.06}, spine={"ry": -14}, head={"ry": 10},
             legR={"ry": 6}, legL={"ry": -4}, armR={"ry": -132}, armL={"ry": 44},
             weapon={"ry": 8}),
        pose(hips={"tz": -0.01}, spine={"ry": 2}, head={"ry": -2},
             armR={"ry": -22}, armL={"ry": 24}, weapon={"ry": 6}),
    ]


def clip_dodge():
    # in-place back-hop: body coils, leans away, lands crouched
    return [
        pose(hips={"tz": -0.06}, spine={"ry": 10}, head={"ry": -6},
             legR={"ry": -14}, legL={"ry": 10}, armR={"ry": 14}, armL={"ry": -14},
             root={"tx": -0.03}),
        pose(hips={"tz": -0.02}, spine={"ry": -10, "rz": 14}, head={"ry": 6},
             legR={"ry": -26}, legL={"ry": 20}, armR={"ry": -24, "rx": -16},
             armL={"ry": 34}, root={"tx": -0.18, "tz": 0.07}),
        pose(hips={"tz": 0.0}, spine={"ry": -18, "rz": 22}, head={"ry": 8},
             legR={"ry": -10}, legL={"ry": 30}, armR={"ry": -34, "rx": -24},
             armL={"ry": 42}, root={"tx": -0.25, "tz": 0.03}),
        pose(hips={"tz": -0.07}, spine={"ry": 12, "rz": 6}, head={"ry": -6},
             legR={"ry": -10}, legL={"ry": 8}, armR={"ry": 12}, armL={"ry": -8},
             root={"tx": -0.06}),
    ]


def clip_hurt():
    return [
        pose(hips={"tz": -0.03}, spine={"ry": -18}, head={"ry": -22},
             armR={"ry": 30}, armL={"ry": -40}, legR={"ry": -8}, legL={"ry": 10},
             root={"tx": -0.05}),
        pose(hips={"tz": -0.06}, spine={"ry": -30, "rz": 6}, head={"ry": -32},
             armR={"ry": 44, "rx": -12}, armL={"ry": -56}, legR={"ry": -14},
             legL={"ry": 18}, root={"tx": -0.11}),
    ]


def clip_death():
    # kneel collapse (single rigid leg bone: no true floor contact, see README)
    return [
        pose(hips={"tz": -0.02}, spine={"ry": -8}, head={"ry": -12},
             armR={"ry": 16}, armL={"ry": -16}),
        pose(hips={"tz": -0.12}, spine={"ry": 14}, head={"ry": 8},
             legR={"ry": 22}, legL={"ry": 20}, armR={"ry": -10}, armL={"ry": 24}),
        pose(hips={"tz": -0.30}, spine={"ry": 32}, head={"ry": 18},
             legR={"ry": 44}, legL={"ry": 40}, armR={"ry": 4}, armL={"ry": 36},
             weapon={"ry": 14}),
        pose(hips={"tz": -0.44}, spine={"ry": 46}, head={"ry": 26},
             legR={"ry": 58}, legL={"ry": 54}, armR={"ry": 16}, armL={"ry": 48},
             weapon={"ry": 22}),
        pose(hips={"tz": -0.53}, spine={"ry": 58}, head={"ry": 32},
             legR={"ry": 66}, legL={"ry": 62}, armR={"ry": 24}, armL={"ry": 56},
             weapon={"ry": 30}),
        pose(hips={"tz": -0.56}, spine={"ry": 64}, head={"ry": 36},
             legR={"ry": 70}, legL={"ry": 66}, armR={"ry": 28}, armL={"ry": 60},
             weapon={"ry": 34}),
    ]


def clip_special():
    # energy finisher: coil with the blade low, burst upward, slam down
    return [
        pose(hips={"tz": -0.05, "rz": -6}, spine={"ry": 8, "rz": -10}, head={"ry": -10},
             armR={"ry": 30}, armL={"ry": -30}, weapon={"ry": 20}),
        pose(hips={"tz": -0.13, "rz": -12}, spine={"ry": 18, "rz": -20}, head={"ry": -16},
             legR={"ry": -10}, legL={"ry": 8}, armR={"ry": 56}, armL={"ry": -48},
             weapon={"ry": 42}),
        pose(hips={"tz": 0.09, "rz": 4}, spine={"ry": -20, "rz": 6}, head={"ry": 12},
             legR={"ry": 6}, legL={"ry": -6}, armR={"ry": -134}, armL={"ry": 50},
             weapon={"ry": -22}),
        pose(hips={"tz": -0.10, "rz": 10, "tx": 0.05}, spine={"ry": 34, "rz": 16},
             head={"ry": 14}, legR={"ry": 14}, legL={"ry": -16},
             armR={"ry": -18}, armL={"ry": -34}, weapon={"ry": 18}),
        pose(hips={"tz": -0.05, "rz": 4}, spine={"ry": 18, "rz": 8}, head={"ry": 4},
             armR={"ry": 6}, armL={"ry": -12}, weapon={"ry": 10}),
        pose(hips={"tz": -0.01}, spine={"ry": 4}, head={"ry": -2}, armR={"ry": 2},
             weapon={"ry": 2}),
    ]


CLIPS = [
    # name, builder, fps, loop
    ("idle", clip_idle, 8, True),
    ("walk", clip_walk, 12, True),
    ("attack1", clip_attack1, 14, False),
    ("attack2", clip_attack2, 14, False),
    ("attack3", clip_attack3, 12, False),
    ("dodge", clip_dodge, 16, False),
    ("hurt", clip_hurt, 14, False),
    ("death", clip_death, 10, False),
    ("special", clip_special, 12, False),
]

ad = ARM.animation_data_create()
actions = {}
for name, builder, fps, loop in CLIPS:
    frames = builder()
    ad.action = None
    for i, p in enumerate(frames, start=1):
        apply_pose(p)
        for pb in ARM.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=i, group=pb.name)
            pb.keyframe_insert("location", frame=i, group=pb.name)
    act = ad.action
    if act is None:
        raise RuntimeError("no action auto-created for " + name)
    act.name = name
    act.use_fake_user = True
    act["fps"] = fps
    act["loop"] = loop
    act["frame_count"] = len(frames)
    try:
        act.use_frame_range = True
        act.frame_start = 1
        act.frame_end = len(frames)
    except Exception as exc:  # pragma: no cover
        print("frame range prop failed:", exc)
    actions[name] = act
    ad.action = None
    print(f"action {name}: {len(frames)} frames @ {fps}fps")

# NLA storage (muted tracks; the active action still previews)
for name, _b, _f, _l in CLIPS:
    try:
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 1, actions[name])
        strip.name = name
        track.mute = True
    except Exception as exc:
        print("NLA stash failed for", name, exc)
ad.action = actions["idle"]
ad.use_nla = True

# ----------------------------------------------------------------------------
# camera / lights / render settings
# ----------------------------------------------------------------------------
# 96 cell px, 56 px character, anchor 8 px above the cell bottom
ORTHO_SCALE = 1.70 * 384 / 224.0            # = 2.9143
WORLD_PER_PX = ORTHO_SCALE / 384.0
# frame centre world z so that feet (z=0) land 32 render px above the bottom edge
CAM_TARGET = Vector((0.0, 0.0, (192 - 32) * WORLD_PER_PX))

cam_data = bpy.data.cameras.new("Camera")
cam_data.type = "ORTHO"
cam_data.ortho_scale = ORTHO_SCALE
cam_data.clip_start = 0.05
cam_data.clip_end = 60.0
CAM = bpy.data.objects.new("Camera", cam_data)
COLL.objects.link(CAM)
yaw = math.radians(12.0)
pitch = math.radians(6.0)
direction = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
CAM.location = CAM_TARGET + direction * 6.0
CAM.rotation_euler = (CAM_TARGET - CAM.location).to_track_quat("-Z", "Y").to_euler()
SCENE.camera = CAM

world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
SCENE.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.055, 0.07, 0.105, 1.0)
bg.inputs["Strength"].default_value = 1.2


def sun(name, from_dir, energy, colour, angle_deg):
    d = bpy.data.lights.new(name, "SUN")
    d.energy = energy
    d.color = colour
    d.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new(name, d)
    COLL.objects.link(ob)
    travel = -Vector(from_dir).normalized()
    ob.rotation_euler = travel.to_track_quat("-Z", "Y").to_euler()
    ob.location = (0, 0, 3)
    return ob


sun("KeyLight", (-1.0, -1.15, 1.6), 4.2, (1.0, 0.96, 0.90), 8.0)
sun("FillLight", (1.2, -1.0, 0.55), 1.5, (0.45, 0.62, 1.0), 30.0)
sun("RimLight", (-1.4, 1.1, 1.3), 2.2, (1.0, 0.78, 0.55), 14.0)

SCENE.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [
    e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
] else "BLENDER_EEVEE"
SCENE.render.resolution_x = 384
SCENE.render.resolution_y = 384
SCENE.render.resolution_percentage = 100
SCENE.render.film_transparent = True
SCENE.render.image_settings.file_format = "PNG"
SCENE.render.image_settings.color_mode = "RGBA"
SCENE.render.image_settings.color_depth = "8"
SCENE.render.image_settings.compression = 15
SCENE.render.fps = 24
SCENE.frame_start = 1
SCENE.frame_end = 6
try:
    SCENE.eevee.taa_render_samples = 16
    SCENE.eevee.use_raytracing = False
except Exception as exc:
    print("eevee settings:", exc)
SCENE.view_settings.view_transform = "Standard"
SCENE.view_settings.look = "None"
SCENE.view_settings.exposure = 0.0
SCENE.view_settings.gamma = 1.0

SCENE["art_contract"] = json.dumps({
    "cell": [96, 96],
    "anchor": [48, 88],
    "facing": "+X",
    "render_size": [384, 384],
    "supersample": 4,
    "camera": {"yaw_deg": 12, "pitch_deg": 6, "ortho_scale": ORTHO_SCALE},
    "clips": {n: {"frames": len(b()), "fps": f, "loop": l} for n, b, f, l in CLIPS},
})

os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print("SAVED", OUT_BLEND)
print("SUMMARY " + json.dumps({
    "verts": len(HERO.data.vertices),
    "polys": len(HERO.data.polygons),
    "materials": [m.name for m in HERO.data.materials],
    "bones": [b.name for b in arm_data.bones],
    "actions": {n: a.frame_range[:] for n, a in actions.items()},
    "engine": SCENE.render.engine,
    "ortho_scale": ORTHO_SCALE,
    "cam_target": list(CAM_TARGET),
}))
