"""Build the four enemy characters for the pixel-action Blender pipeline.

Run (from the project root), one process per character:

    blender -b --factory-startup -P tools/blender/enemies/build_enemies.py -- --kind grunt
    blender -b --factory-startup -P tools/blender/enemies/build_enemies.py -- --kind brute
    blender -b --factory-startup -P tools/blender/enemies/build_enemies.py -- --kind ranger
    blender -b --factory-startup -P tools/blender/enemies/build_enemies.py -- --kind boss

Output:
    art-source/blender/enemies/<kind>.blend

Same technical route as the hero pipeline (tools/blender/build_hero.py):
flat-colour materials, facing +X, feet on z=0, 9-bone rig
(root/hips/spine/head/armR/armL/legR/legL/weapon), the 9 contract actions.

The only deliberate difference is scale: every character is modelled at its own
world height so that, at its own orthographic scale, the body is exactly
`target_px` cell pixels tall (4x supersample for the 96 cells, 3.2x for the
160 boss cell).  The camera yaw/pitch are identical to the hero.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))
OUT_DIR = os.path.join(ROOT, "art-source", "blender", "enemies")

# ----------------------------------------------------------------------------
# scene reset (one character per Blender process)
# ----------------------------------------------------------------------------
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions,
             bpy.data.cameras, bpy.data.lights, bpy.data.materials):
    for item in list(coll):
        if item.users == 0:
            coll.remove(item)

SCENE = bpy.context.scene
COLL = SCENE.collection
PARTS: list[bpy.types.Object] = []


# ----------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------
def mat(name, rgb, rough=0.72, metal=0.0, spec=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    # 按类型找节点，别按名字找：中文界面下节点名是「原理化 BSDF」
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise RuntimeError("material %s has no Principled BSDF" % name)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = spec
            break
    m.diffuse_color = (*rgb, 1.0)
    return m


def emissive(name, rgb, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*rgb, 1.0)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs[0])
    m.diffuse_color = (*rgb, 1.0)
    return m


# ----------------------------------------------------------------------------
# mesh helpers (same primitives as build_hero.py)
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


def prism(name, origin, u, v, n, poly, thick, material, bone):
    """Flat plate: polygon in the (u,v) plane, extruded +-thick/2 along n."""
    o = Vector(origin)
    u = Vector(u).normalized()
    v = Vector(v).normalized()
    n = Vector(n).normalized()
    k = len(poly)
    verts = []
    for s in (-1, 1):
        for a, b in poly:
            verts.append(tuple(o + u * a + v * b + n * (s * thick * 0.5)))
    faces = [tuple(range(k)), tuple(range(k, 2 * k))]
    for i in range(k):
        j = (i + 1) % k
        faces.append((i, j, k + j, k + i))
    return mesh_obj(name, verts, faces, material, bone)


def basis(axis, broadside=Vector((0, 1, 0))):
    """u = axis, v = in-broadside-plane perpendicular, n = plate normal."""
    u = Vector(axis).normalized()
    n = Vector(broadside).normalized()
    v = n.cross(u).normalized()
    return u, v, n


# ----------------------------------------------------------------------------
# rig helpers
# ----------------------------------------------------------------------------
def make_armature(name, bones, rig_name):
    arm_data = bpy.data.armatures.new(rig_name)
    arm = bpy.data.objects.new(rig_name, arm_data)
    COLL.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    created = {}
    for spec in bones:
        bn, head, tail = spec["name"], spec["head"], spec["tail"]
        parent, connect, deform = spec.get("parent"), spec.get("connect", False), spec.get("deform", True)
        b = eb.new(bn)
        b.head = Vector(head)
        b.tail = Vector(tail)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        b.use_deform = deform
        created[bn] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.show_in_front = True
    arm_data.display_type = "OCTAHEDRAL"
    return arm


def join_and_bind(arm, mesh_name):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in PARTS:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = mesh_name
    ob.data.name = mesh_name
    ob.parent = arm
    ob.matrix_parent_inverse = Matrix.Identity(4)
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    return ob


# ----------------------------------------------------------------------------
# clip set (shared with the hero; translations are scaled by body height)
# ----------------------------------------------------------------------------
BASE = {}
MOTION = 1.0
DEATH_F = 0.72


def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def pose(**over):
    """BASE + additive world-axis overrides (degrees for rotations, metres for t)."""
    out = {k: dict(v) for k, v in BASE.items()}
    for bone_name, spec in over.items():
        dst = out.setdefault(bone_name, {})
        for key, value in spec.items():
            if key in ("tx", "ty", "tz"):
                value = value * MOTION
            dst[key] = dst.get(key, 0.0) + value
    return out


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


def _retarget_bow(poses, keep=1.0, tilt=-6.0):
    """把「弓跟着手臂甩」改成「弓保持大致竖直、微微前倾（弓腹朝目标）」。

    weapon 是 armR 的子骨，所以 weapon.ry 必须**反向**抵消 armR.ry；
    keep 控制抵消比例（1.0 = 完全抵消），tilt 是要保留的固定前倾角。
    """
    out = []
    for p in poses:
        q = {k: dict(v) for k, v in p.items()}
        arm = q.get("armR", {}).get("ry", 0.0)
        w = q.setdefault("weapon", {})
        w["ry"] = -arm * keep + tilt
        out.append(q)
    return out


def clip_idle_ranger():
    """弓手待机：手臂放低、弓竖直低垂并微微前倾（弓腹朝向目标）。

    上一版把 armR 和 weapon 同向相加，弓被转了 ~70° 变成横的 —— 那是错的。
    """
    return _retarget_bow([
        pose(armR={"ry": 22}, armL={"ry": -6}),
        pose(hips={"tz": 0.012}, spine={"ry": 1.5}, head={"ry": -1.5},
             armR={"ry": 20}, armL={"ry": -4}),
        pose(hips={"tz": 0.004}, spine={"ry": 2.5}, head={"ry": -2.5},
             armR={"ry": 19}, armL={"ry": -3}),
        pose(hips={"tz": -0.004}, spine={"ry": 0.5}, head={"ry": -0.5},
             armR={"ry": 24}, armL={"ry": -7}),
    ], keep=1.0, tilt=-8)


def clip_walk_ranger():
    """弓手走路：身体动，但弓大致指向目标，不跟着手臂来回甩。"""
    return _retarget_bow(clip_walk(), keep=0.9, tilt=-8)


def clip_walk():
    return [
        pose(hips={"tz": -0.022, "ty": 0.012}, spine={"ry": 7, "rz": 8},
             head={"ry": -6, "rz": -5}, legR={"ry": -38}, legL={"ry": 32},
             armR={"ry": 28}, armL={"ry": -24}, weapon={"ry": 6}),
        pose(hips={"tz": 0.012}, spine={"ry": 5, "rz": 3}, head={"ry": -4, "rz": -2},
             legR={"ry": -16}, legL={"ry": 13}, armR={"ry": 10}, armL={"ry": -8}),
        pose(hips={"tz": -0.008}, spine={"ry": 5, "rz": -3}, head={"ry": -4},
             legR={"ry": 12}, legL={"ry": -12}, armR={"ry": -8}, armL={"ry": 8}),
        pose(hips={"tz": -0.022, "ty": -0.012}, spine={"ry": 7, "rz": -8},
             head={"ry": -6, "rz": 5}, legR={"ry": 32}, legL={"ry": -38},
             armR={"ry": -24}, armL={"ry": 28}, weapon={"ry": -6}),
        pose(hips={"tz": 0.012}, spine={"ry": 5, "rz": -3}, head={"ry": -4, "rz": 2},
             legR={"ry": 13}, legL={"ry": -16}, armR={"ry": -8}, armL={"ry": 10}),
        pose(hips={"tz": -0.008}, spine={"ry": 5, "rz": 3}, head={"ry": -4},
             legR={"ry": -12}, legL={"ry": 12}, armR={"ry": 8}, armL={"ry": -8}),
    ]


def clip_attack1():
    return [
        pose(hips={"tz": -0.02, "rz": -8}, spine={"ry": -2, "rz": -28},
             head={"rz": -12}, armR={"ry": -105, "rx": -14}, armL={"ry": 22},
             legR={"ry": -8}, legL={"ry": 8}, weapon={"ry": -30}),
        pose(hips={"tz": -0.01, "rz": 2}, spine={"ry": 4, "rz": 4}, head={"rz": 4},
             armR={"ry": -76, "rx": -10}, armL={"ry": -8}, weapon={"ry": 26}),
        pose(hips={"tz": -0.02, "rz": 14, "tx": 0.05}, spine={"ry": 9, "rz": 30},
             head={"rz": 10, "ry": -4}, armR={"ry": -24, "rx": 2}, armL={"ry": -30},
             legR={"ry": 10}, legL={"ry": -12}, weapon={"ry": 16}),
        pose(hips={"tz": -0.006, "rz": 4}, spine={"ry": 5, "rz": 10}, head={"rz": 2},
             armR={"ry": 4}, armL={"ry": -6}, weapon={"ry": 2}),
    ]


def clip_attack2():
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
             legR={"ry": 6}, legL={"ry": -4}, armR={"ry": -118}, armL={"ry": 44},
             weapon={"ry": 8}),
        pose(hips={"tz": -0.01}, spine={"ry": 2}, head={"ry": -2},
             armR={"ry": -22}, armL={"ry": 24}, weapon={"ry": 6}),
    ]


def clip_shoot():
    """弓手拉弓：举弓 → 拉弦 → 满弓 → 放箭 → 回位。

    只有 ranger 用这个剪辑（见 clips_for）。弓在 weapon 骨上、随 armR 抬起；
    armL 是拉弦手，靠 ry 正值往后收。6 帧 @14fps ≈ 0.43s，正好对上
    ATTACKS.shoot 的 startup 8 + active 1 + recovery 16（25 逻辑帧）。
    """
    return [
        # 1 举弓瞄准（weapon 反向补偿 armR，让弓保持竖直）
        pose(hips={"rz": -4}, spine={"ry": 2, "rz": -6}, head={"rz": -2},
             armR={"ry": -58, "rx": -4}, armL={"ry": 18},
             legR={"ry": -4}, legL={"ry": 4}, weapon={"ry": 52}),
        # 2 开始拉弦（躯干后仰、向远侧拧）
        pose(hips={"rz": -8, "tz": -0.008}, spine={"ry": -2, "rz": -18}, head={"rz": -8},
             armR={"ry": -64, "rx": -8}, armL={"ry": 72},
             legR={"ry": -6}, legL={"ry": 8}, weapon={"ry": 58}),
        # 3 满弓（身体后仰拧腰，拉弦手到脸颊）
        pose(hips={"rz": -12, "tz": -0.018}, spine={"ry": -6, "rz": -30}, head={"rz": -14, "ry": -2},
             armR={"ry": -66, "rx": -14}, armL={"ry": 100},
             legR={"ry": -10}, legL={"ry": 12}, weapon={"ry": 62}),
        # 4 放箭（躯干前送、拉弦手弹出）
        pose(hips={"rz": -2, "tz": -0.004}, spine={"ry": 10, "rz": -2}, head={"rz": 2},
             armR={"ry": -60, "rx": -2}, armL={"ry": -24},
             legR={"ry": -4}, legL={"ry": 4}, weapon={"ry": 54}),
        # 5 后坐回位
        pose(hips={"rz": 2}, spine={"ry": 4, "rz": 6}, head={"rz": 2},
             armR={"ry": -28}, armL={"ry": 8},
             legR={"ry": 2}, legL={"ry": -2}, weapon={"ry": 26}),
    ]


def clip_aim():
    """弓手在射程内的「持弓待发」：满弓姿势 + 轻微呼吸起伏（2 帧循环）。

    和 clip_shoot 的第 3 帧同源，所以从「瞄准」切到「放箭」时不会跳姿势。

    弓的姿态：weapon 的 ry 在反向补偿 armR 的基础上**再加 90°**（62 → 152）。
    侧视机位下弓原本是"侧着"的，玩家只能看到弓背侧面；转 90° 后整个 C 形
    与弓弦正对镜头，弦在朝向目标的一侧。
    """
    return [
        pose(hips={"rz": -12, "tz": -0.018}, spine={"ry": -6, "rz": -30}, head={"rz": -14, "ry": -2},
             armR={"ry": -66, "rx": -14}, armL={"ry": 100},
             legR={"ry": -10}, legL={"ry": 12}, weapon={"ry": 62}),
        pose(hips={"rz": -11, "tz": -0.022}, spine={"ry": -5, "rz": -28}, head={"rz": -13, "ry": -2},
             armR={"ry": -65, "rx": -13}, armL={"ry": 98},
             legR={"ry": -10}, legL={"ry": 12}, weapon={"ry": 61}),
    ]


def clip_dodge():
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
        pose(hips={"tz": -0.03, "rz": 4}, spine={"ry": -22, "rz": -6}, head={"ry": -26},
             armR={"ry": 38, "rx": -14}, armL={"ry": -48}, legR={"ry": -10}, legL={"ry": 12},
             root={"tx": -0.06}),
        pose(hips={"tz": -0.07, "rz": 8}, spine={"ry": -38, "rz": -12}, head={"ry": -38},
             armR={"ry": 54, "rx": -22}, armL={"ry": -64}, legR={"ry": -18},
             legL={"ry": 22}, root={"tx": -0.14}),
    ]


def clip_death():
    """topple around the feet; DEATH_F keeps the sprite inside its cell aspect."""
    seq = [
        (0.0, dict(hips={"tz": -0.02}, spine={"ry": -10}, head={"ry": -14},
                   armR={"ry": 18}, armL={"ry": -18})),
        (10.0, dict(root={"ry": -10, "tx": -0.04}, hips={"tz": -0.05}, spine={"ry": -16},
                    head={"ry": -18}, legR={"ry": -8}, legL={"ry": 10},
                    armR={"ry": 30, "rx": -12}, armL={"ry": -34})),
        (30.0, dict(root={"ry": -30, "tx": -0.02}, hips={"tz": -0.09}, spine={"ry": -6},
                    head={"ry": -10}, legR={"ry": -18}, legL={"ry": -6},
                    armR={"ry": 44, "rx": -20}, armL={"ry": -40}, weapon={"ry": 10})),
        (54.0, dict(root={"ry": -54, "tx": 0.18}, hips={"tz": -0.04}, spine={"ry": 6},
                    head={"ry": 4}, legR={"ry": -26}, legL={"ry": -18},
                    armR={"ry": 40, "rx": -24}, armL={"ry": -26}, weapon={"ry": 14})),
        (72.0, dict(root={"ry": -72, "tx": 0.40, "tz": 0.04}, spine={"ry": 6}, head={"ry": 8},
                    legR={"ry": -20}, legL={"ry": -14}, armR={"ry": 24, "rx": -20},
                    armL={"ry": -12}, weapon={"ry": 8})),
        (82.0, dict(root={"ry": -82, "tx": 0.55, "tz": 0.09}, spine={"ry": 4}, head={"ry": 10},
                    legR={"ry": -12}, legL={"ry": -6}, armR={"ry": 12, "rx": -14},
                    armL={"ry": -4}, weapon={"ry": 4})),
    ]
    out = []
    for ang, spec in seq:
        spec = dict(spec)
        if "root" in spec:
            rs = dict(spec["root"])
            rs["ry"] = rs.get("ry", 0.0) * DEATH_F
            if "tx" in rs:
                rs["tx"] = rs["tx"] * DEATH_F
            spec["root"] = rs
        out.append(pose(**spec))
    return out


def clip_special():
    return [
        pose(hips={"tz": -0.05, "rz": -6}, spine={"ry": 8, "rz": -10}, head={"ry": -10},
             armR={"ry": 30}, armL={"ry": -30}, weapon={"ry": 20}),
        pose(hips={"tz": -0.13, "rz": -12}, spine={"ry": 18, "rz": -20}, head={"ry": -16},
             legR={"ry": -10}, legL={"ry": 8}, armR={"ry": 56}, armL={"ry": -48},
             weapon={"ry": 42}),
        pose(hips={"tz": 0.09, "rz": 4}, spine={"ry": -20, "rz": 6}, head={"ry": 12},
             legR={"ry": 6}, legL={"ry": -6}, armR={"ry": -120}, armL={"ry": 50},
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
    # name, builder, fps, loop, target_frames（0 = 不重采样）
    ("idle", clip_idle, 8, True, 8),
    ("walk", clip_walk, 12, True, 12),
    ("attack1", clip_attack1, 14, False, 6),
    ("attack2", clip_attack2, 14, False, 0),
    ("attack3", clip_attack3, 12, False, 0),
    ("dodge", clip_dodge, 16, False, 0),
    ("hurt", clip_hurt, 14, False, 3),
    ("death", clip_death, 10, False, 0),
    ("special", clip_special, 12, False, 0),
]

# 只有弓手需要「拉弓」剪辑；其它角色共用上面的表，避免多渲一套没用的帧。
EXTRA_CLIPS = {
    "ranger": [
        ("aim", clip_aim, 6, True, 2),
        ("shoot", clip_shoot, 14, False, 6),
    ],
}

# 按角色覆盖某个共用剪辑的构建函数（弓手的待机/走路要让弓保持朝向目标）
CLIP_OVERRIDES = {
    "ranger": {"idle": clip_idle_ranger, "walk": clip_walk_ranger},
}


def clips_for(kind):
    overrides = CLIP_OVERRIDES.get(kind, {})
    clips = [(n, overrides.get(n, b), f, l, t) for n, b, f, l, t in CLIPS]
    return clips + EXTRA_CLIPS.get(kind, [])


def _lerp_pose(a, b, t):
    out = {}
    for bone_name in set(a) | set(b):
        pa = a.get(bone_name, {})
        pb = b.get(bone_name, {})
        spec = {}
        for key in set(pa) | set(pb):
            va = pa.get(key, 0.0)
            vb = pb.get(key, 0.0)
            spec[key] = va + (vb - va) * t
        out[bone_name] = spec
    return out


def resample_clip(poses, target, loop):
    """相邻 pose 线性插值，把稀疏动画补密（循环剪辑用环绕插值）。"""
    n = len(poses)
    if target <= 0 or target == n:
        return list(poses)
    out = []
    for i in range(target):
        if loop:
            u = i * n / target
        else:
            u = i * (n - 1) / (target - 1) if target > 1 else 0.0
        i0 = int(math.floor(u)) % n
        i1 = (i0 + 1) % n if loop else min(i0 + 1, n - 1)
        t = u - math.floor(u)
        out.append(_lerp_pose(poses[i0], poses[i1], t))
    return out


def bake_actions(arm, clips):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    ad = arm.animation_data_create()
    actions = {}
    for name, builder, fps, loop, target in clips:
        raw = builder()
        frames = resample_clip(raw, target, loop)
        fps = round(fps * len(frames) / len(raw))
        ad.action = None
        for i, p in enumerate(frames, start=1):
            reset_pose(arm)
            for bone_name, spec in p.items():
                pb = arm.pose.bones[bone_name]
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
            for pb in arm.pose.bones:
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
        print("action %s: %d frames @ %dfps" % (name, len(frames), fps))

    for name, _b, _f, _l, _t in CLIPS:
        try:
            track = ad.nla_tracks.new()
            track.name = name
            strip = track.strips.new(name, 1, actions[name])
            strip.name = name
            track.mute = True
        except Exception as exc:  # pragma: no cover
            print("NLA stash failed for", name, exc)
    ad.action = actions["idle"]
    ad.use_nla = True
    return actions


# ----------------------------------------------------------------------------
# camera / lights / render settings (identical to the hero route)
# ----------------------------------------------------------------------------
def setup_scene(kind, height, target_px, render_px, cell, anchor, samples=16):
    ss = render_px / float(cell)
    world_per_px = height / (float(target_px) * ss)   # body == target_px cell px tall
    ortho_scale = world_per_px * render_px
    pad_bottom = render_px - anchor[1] * ss
    cam_target = Vector((0.0, 0.0, (render_px * 0.5 - pad_bottom) * world_per_px))

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam_data.clip_start = 0.05
    cam_data.clip_end = 80.0
    cam = bpy.data.objects.new("Camera", cam_data)
    COLL.objects.link(cam)
    yaw = math.radians(12.0)
    pitch = math.radians(6.0)
    direction = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch),
                        math.sin(pitch)))
    cam.location = cam_target + direction * 8.0
    cam.rotation_euler = (cam_target - cam.location).to_track_quat("-Z", "Y").to_euler()
    SCENE.camera = cam

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    SCENE.world = world
    world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    bg.inputs["Color"].default_value = (0.055, 0.07, 0.105, 1.0)
    bg.inputs["Strength"].default_value = 1.4

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

    sun("KeyLight", (-1.0, -1.15, 1.6), 3.2, (1.0, 0.96, 0.90), 8.0)
    sun("FillLight", (1.2, -1.0, 0.55), 1.3, (0.45, 0.62, 1.0), 30.0)
    sun("RimLight", (-1.4, 1.1, 1.3), 1.8, (1.0, 0.78, 0.55), 14.0)

    SCENE.render.engine = "BLENDER_EEVEE"
    SCENE.render.resolution_x = render_px
    SCENE.render.resolution_y = render_px
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
        SCENE.eevee.taa_render_samples = samples
        SCENE.eevee.use_raytracing = False
    except Exception as exc:
        print("eevee settings:", exc)
    SCENE.view_settings.view_transform = "Standard"
    SCENE.view_settings.look = "None"
    SCENE.view_settings.exposure = 0.0
    SCENE.view_settings.gamma = 1.0

    cfg = {
        "kind": kind,
        "height": height,
        "render_px": render_px,
        "cell": cell,
        "anchor": list(anchor),
        "target_px": target_px,
        "supersample": ss,
        "ortho_scale": ortho_scale,
        "world_per_px": world_per_px,
        "cam_target": list(cam_target),
        "camera": {"yaw_deg": 12, "pitch_deg": 6},
        "facing": "+X",
    }
    return cfg


# ============================================================================
# GRUNT  - small hunched goblin thief, green rags, short dagger
# ============================================================================
def build_grunt():
    global BASE, MOTION, DEATH_F
    height = 1.05
    MOTION = height / 1.70
    DEATH_F = 0.74

    M = {
        "skin": mat("gr_skin", (0.53, 0.59, 0.22), rough=0.66),
        "skin_d": mat("gr_skin_d", (0.34, 0.40, 0.14), rough=0.72),
        "rag": mat("gr_rag", (0.115, 0.155, 0.100), rough=0.88),
        "rag_d": mat("gr_rag_d", (0.070, 0.100, 0.070), rough=0.90),
        "leather": mat("gr_leather", (0.38, 0.24, 0.10), rough=0.72),
        "metal": mat("gr_metal", (0.74, 0.77, 0.82), rough=0.30, metal=0.65, spec=0.6),
        "eye": mat("gr_eye", (1.00, 0.88, 0.05), rough=0.28),
        "tooth": mat("gr_tooth", (0.95, 0.93, 0.86), rough=0.45),
    }

    # legs -----------------------------------------------------------------
    for side, tag in ((-1, "R"), (1, "L")):
        hip = (0.0, 0.072 * side, 0.46)
        knee = (0.02, 0.078 * side, 0.27)
        ankle = (0.035, 0.080 * side, 0.10)
        tube("thigh" + tag, hip, knee, 0.052, 0.040, 6, M["rag_d"], "leg" + tag)
        ico("knee" + tag, knee, 0.040, (1.0, 0.95, 0.9), M["rag_d"], "leg" + tag, subdiv=1)
        tube("shin" + tag, knee, ankle, 0.040, 0.030, 6, M["rag_d"], "leg" + tag)
        taper_box("boot" + tag, (0.058, 0.080 * side, 0.0), (0.034, 0.080 * side, 0.128),
                  0.090, 0.176, 0.082, 0.110, M["leather"], "leg" + tag)
        taper_box("bootcuff" + tag, (0.032, 0.079 * side, 0.118), (0.030, 0.079 * side, 0.185),
                  0.080, 0.102, 0.090, 0.096, M["leather"], "leg" + tag)
        # ragged wrap over the shin
        tube("wrap" + tag, (0.030, 0.077 * side, 0.20), (0.034, 0.078 * side, 0.25),
             0.045, 0.045, 6, M["rag"], "leg" + tag)

    # torso (hunched forward: every segment shifts +X going up) -------------
    taper_box("pelvis", (0.0, 0.0, 0.455), (0.008, 0.0, 0.555), 0.190, 0.150, 0.180, 0.140,
              M["rag"], "hips")
    taper_box("waist", (0.008, 0.0, 0.555), (0.030, 0.0, 0.655), 0.180, 0.140, 0.192, 0.136,
              M["rag"], "spine")
    taper_box("chest", (0.030, 0.0, 0.655), (0.072, 0.0, 0.800), 0.192, 0.136, 0.295, 0.168,
              M["rag"], "spine")
    # hunched back bundle (reads as the hump from the side)
    ico("hump", (-0.092, 0.0, 0.800), 0.122, (1.02, 0.86, 0.82), M["rag_d"], "spine", subdiv=2)
    ico("hump2", (-0.060, 0.0, 0.716), 0.090, (0.95, 0.90, 0.72), M["rag_d"], "spine", subdiv=1)
    # belt + pouch
    taper_box("belt", (0.008, 0.0, 0.545), (0.014, 0.0, 0.585), 0.188, 0.148, 0.186, 0.146,
              M["leather"], "hips")
    box_frame("buckle", (0.088, 0.0, 0.565), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.010, 0.026, 0.020, M["metal"], "hips")
    ico("pouch", (0.02, -0.102, 0.520), 0.048, (1.1, 0.85, 0.9), M["leather"], "hips", subdiv=1)
    # ragged tunic strips hanging from the belt
    for i, (yy, dx, ln) in enumerate(((-0.075, 0.10, 0.085), (0.0, 0.105, 0.105),
                                      (0.075, 0.10, 0.080), (-0.035, -0.085, 0.070),
                                      (0.045, -0.085, 0.065))):
        prism("rag_strip_%d" % i, (dx, yy, 0.545), Vector((0, 1, 0)), Vector((0, 0, -1)),
              Vector((1, 0, 0)),
              [(-0.042, 0.0), (0.042, 0.0), (0.016, -ln), (-0.028, -ln * 0.72)],
              0.055, M["rag_d"], "hips")

    # arms ------------------------------------------------------------------
    for side, tag, bone in ((-1, "R", "armR"), (1, "L", "armL")):
        sh = (0.020, 0.163 * side, 0.775)
        el = (0.070, 0.205 * side, 0.600)
        wr = (0.140, 0.215 * side, 0.462)
        tube("upperarm" + tag, sh, el, 0.042, 0.034, 6, M["rag"], bone)
        tube("forearm" + tag, el, wr, 0.034, 0.027, 6, M["skin"], bone)
        ico("hand" + tag, (0.150, 0.217 * side, 0.442), 0.038, (1.1, 0.9, 1.0),
            M["skin"], bone, subdiv=1)
        ico("shoulderpad" + tag, (0.018, 0.166 * side, 0.782), 0.055,
            (1.0, 1.0, 0.7), M["rag_d"], "spine", subdiv=1)

    # head (big, pointed ears, long nose) ----------------------------------
    ico("head", (0.080, 0.0, 0.905), 0.114, (1.05, 0.95, 1.00), M["skin"], "head", subdiv=2)
    ico("jaw", (0.132, 0.0, 0.852), 0.062, (1.12, 0.92, 0.82), M["skin"], "head", subdiv=1)
    tube("nose", (0.160, 0.0, 0.898), (0.248, 0.0, 0.872), 0.036, 0.011, 6,
         M["skin"], "head")
    tube("nose_tip", (0.238, 0.0, 0.876), (0.262, 0.0, 0.868), 0.014, 0.006, 5,
         M["skin_d"], "head")
    for side, tag in ((-1, "R"), (1, "L")):
        # long pointed ear sweeping back and up
        tube("ear" + tag, (0.045, 0.082 * side, 0.930), (-0.070, 0.185 * side, 1.005),
             0.045, 0.005, 5, M["skin"], "head")
        # dark socket + bright eye (eye must protrude: at 46px it is ~3px)
        ico("socket" + tag, (0.168, 0.050 * side, 0.948), 0.052, (0.55, 1.05, 0.80),
            M["skin_d"], "head", subdiv=2)
        ico("eye" + tag, (0.186, 0.050 * side, 0.950), 0.040, (0.45, 0.95, 0.62),
            M["eye"], "head", subdiv=2)
        # heavy brow slab angled down toward the nose
        prism("brow" + tag, (0.160, 0.052 * side, 0.982), Vector((0, 1, 0)),
              Vector((0, 0, 1)), Vector((1, 0, 0)),
              [(-0.048, 0.020), (0.048, 0.030), (0.036, -0.012), (-0.040, -0.010)],
              0.062, M["skin_d"], "head")
    taper_box("mouth", (0.180, 0.0, 0.836), (0.176, 0.0, 0.852), 0.078, 0.034, 0.066, 0.022,
              M["skin_d"], "head")
    for side in (-1, 1):
        ico("tooth_%d" % side, (0.188, 0.022 * side, 0.846), 0.013, (1.0, 1.0, 1.4),
            M["tooth"], "head", subdiv=1)

    # hood / cowl (dark green, peaked backwards) --------------------------
    ico("hood", (-0.020, 0.0, 0.938), 0.118, (1.02, 1.06, 0.99), M["rag_d"], "head", subdiv=2)
    tube("hood_peak", (-0.030, 0.0, 0.990), (-0.205, 0.0, 0.960), 0.086, 0.008, 6,
         M["rag_d"], "head")
    # cowl rim framing the face
    prism("hood_rim", (0.055, 0.0, 0.965), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.100, 0.030), (0.100, 0.030), (0.090, -0.030), (-0.090, -0.030)],
          0.070, M["rag_d"], "head")
    # ragged collar
    taper_box("collar", (0.008, 0.0, 0.775), (0.020, 0.0, 0.822), 0.190, 0.160, 0.150, 0.130,
              M["rag_d"], "spine")

    # dagger ---------------------------------------------------------------
    hand = Vector((0.150, -0.217, 0.442))
    U = Vector((0.66, 0.0, -0.75)).normalized()
    u, v, n = basis(U, (0, 1, 0))
    weapon_len = 0.30
    tube("grip", tuple(hand - U * 0.085), tuple(hand + U * 0.015), 0.021, 0.019, 6,
         M["leather"], "weapon")
    ico("pommel", tuple(hand - U * 0.098), 0.026, (1, 1, 1), M["metal"], "weapon", subdiv=1)
    box_frame("guard", hand + U * 0.022, u, v, n, 0.030, 0.011, 0.020, M["metal"], "weapon")
    blade_poly = [(-0.005, -0.030), (0.150, -0.030), (0.255, -0.006), (0.285, 0.0),
                  (0.255, 0.006), (0.150, 0.030), (-0.005, 0.030)]
    prism("blade", tuple(hand + U * 0.022), u, v, n, blade_poly, 0.013, M["metal"], "weapon")
    # small notch on the spine of the blade
    prism("blade_spine", tuple(hand + U * 0.05), u, v, n,
          [(0.0, 0.028), (0.10, 0.028), (0.10, 0.040), (0.0, 0.040)], 0.010,
          M["leather"], "weapon")

    BASE = {
        "spine": {"ry": 5.0, "rz": -3.0},
        "head": {"ry": -9.0, "rz": 2.0},
        "armR": {"ry": -8.0, "rx": -6.0},
        "armL": {"ry": 10.0, "rx": 6.0},
        "legR": {"ry": 3.0},
        "legL": {"ry": -3.0},
        "weapon": {"ry": 8.0},
    }

    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0, 0.14), "deform": False},
        {"name": "hips", "head": (0, 0, 0.455), "tail": (0, 0, 0.575), "parent": "root"},
        {"name": "spine", "head": (0, 0, 0.575), "tail": (0, 0, 0.785), "parent": "hips",
         "connect": True},
        {"name": "head", "head": (0, 0, 0.785), "tail": (0, 0, 1.020), "parent": "spine",
         "connect": True},
        {"name": "armR", "head": (0.020, -0.163, 0.775), "tail": (0.150, -0.217, 0.442),
         "parent": "spine"},
        {"name": "armL", "head": (0.020, 0.163, 0.775), "tail": (0.150, 0.217, 0.442),
         "parent": "spine"},
        {"name": "legR", "head": (0, -0.072, 0.455), "tail": (0.035, -0.080, 0.100),
         "parent": "hips"},
        {"name": "legL", "head": (0, 0.072, 0.455), "tail": (0.035, 0.080, 0.100),
         "parent": "hips"},
        {"name": "weapon", "head": tuple(hand), "tail": tuple(hand + U * weapon_len),
         "parent": "armR"},
    ]
    cfg = {
        "kind": "grunt", "height": height, "render_px": 384, "cell": 96,
        "anchor": (48, 88), "target_px": 46,
    }
    return cfg, bones, "GruntRig", "GruntMesh"


# ============================================================================
# BRUTE  - heavy armoured slab of a man, orange-brown, giant axe
# ============================================================================
def build_brute():
    global BASE, MOTION, DEATH_F
    height = 1.55
    MOTION = height / 1.70
    DEATH_F = 0.62

    M = {
        "armor": mat("br_armor", (0.55, 0.27, 0.09), rough=0.55, spec=0.4),
        "armor_d": mat("br_armor_d", (0.34, 0.16, 0.06), rough=0.62, spec=0.35),
        "iron": mat("br_iron", (0.31, 0.29, 0.28), rough=0.40, metal=0.55, spec=0.5),
        "iron_d": mat("br_iron_d", (0.155, 0.145, 0.145), rough=0.46, metal=0.45, spec=0.45),
        "iron_l": mat("br_iron_l", (0.47, 0.44, 0.42), rough=0.34, metal=0.60, spec=0.55),
        "leather": mat("br_leather", (0.23, 0.14, 0.07), rough=0.74),
        "skin": mat("br_skin", (0.72, 0.46, 0.32), rough=0.62),
        "skin_d": mat("br_skin_d", (0.55, 0.33, 0.22), rough=0.68),
        "brass": mat("br_brass", (0.82, 0.58, 0.18), rough=0.34, metal=0.7, spec=0.55),
        "steel": mat("br_steel", (0.66, 0.67, 0.71), rough=0.30, metal=0.7, spec=0.6),
        "horn": mat("br_horn", (0.82, 0.76, 0.62), rough=0.5),
        "eye": mat("br_eye", (1.00, 0.55, 0.10), rough=0.25),
    }

    # legs -----------------------------------------------------------------
    for side, tag in ((-1, "R"), (1, "L")):
        hip = (0.0, 0.115 * side, 0.74)
        knee = (0.03, 0.125 * side, 0.42)
        ankle = (0.055, 0.130 * side, 0.14)
        tube("thigh" + tag, hip, knee, 0.098, 0.078, 7, M["leather"], "leg" + tag)
        ico("knee" + tag, knee, 0.088, (1.0, 1.0, 0.82), M["iron"], "leg" + tag, subdiv=1)
        tube("shin" + tag, knee, ankle, 0.080, 0.062, 7, M["leather"], "leg" + tag)
        taper_box("sabaton" + tag, (0.095, 0.130 * side, 0.0), (0.035, 0.130 * side, 0.165),
                  0.165, 0.230, 0.150, 0.185, M["iron"], "leg" + tag)
        taper_box("greave" + tag, (0.040, 0.128 * side, 0.160), (0.026, 0.127 * side, 0.330),
                  0.150, 0.170, 0.150, 0.165, M["armor"], "leg" + tag)
        prism("toeplate" + tag, (0.135, 0.130 * side, 0.055), Vector((0, 1, 0)),
              Vector((0, 0, 1)), Vector((1, 0, 0)),
              [(-0.060, 0.055), (0.060, 0.055), (0.040, -0.050), (-0.040, -0.050)],
              0.135, M["armor_d"], "leg" + tag)

    # torso ----------------------------------------------------------------
    taper_box("faulds", (0.0, 0.0, 0.640), (0.005, 0.0, 0.760), 0.430, 0.320, 0.380, 0.290,
              M["armor_d"], "hips")
    taper_box("pelvis", (0.005, 0.0, 0.755), (0.010, 0.0, 0.870), 0.345, 0.245, 0.330, 0.235,
              M["armor"], "hips")
    taper_box("belt", (0.010, 0.0, 0.855), (0.015, 0.0, 0.900), 0.342, 0.245, 0.345, 0.245,
              M["leather"], "hips")
    box_frame("buckle", (0.150, 0.0, 0.878), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.014, 0.045, 0.036, M["brass"], "hips")
    taper_box("waist", (0.010, 0.0, 0.895), (0.020, 0.0, 0.990), 0.330, 0.235, 0.360, 0.230,
              M["armor"], "spine")
    taper_box("chest", (0.020, 0.0, 0.985), (0.048, 0.0, 1.215), 0.360, 0.230, 0.560, 0.265,
              M["armor"], "spine")
    # chest ridge / pectoral plates
    for side in (-1, 1):
        ico("pec_%d" % side, (0.085, 0.115 * side, 1.150), 0.120, (0.75, 0.85, 0.80),
            M["armor"], "spine", subdiv=1)
    prism("chest_ridge", (0.135, 0.0, 1.120), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.055, 0.095), (0.055, 0.095), (0.0, -0.075)], 0.075, M["brass"], "spine")
    # back plate / hump of muscle
    ico("backplate", (-0.115, 0.0, 1.120), 0.150, (0.70, 1.20, 0.95), M["armor_d"],
        "spine", subdiv=2)

    # pauldrons (wide shoulders = the brute's silhouette) -------------------
    for side in (-1, 1):
        ico("pauldron_a_%d" % side, (0.0, 0.330 * side, 1.205), 0.180, (1.05, 1.10, 0.62),
            M["armor"], "spine", subdiv=2)
        ico("pauldron_b_%d" % side, (0.0, 0.375 * side, 1.120), 0.150, (1.0, 1.05, 0.50),
            M["armor_d"], "spine", subdiv=1)
        ico("pauldron_c_%d" % side, (0.0, 0.405 * side, 1.045), 0.115, (1.0, 1.0, 0.45),
            M["armor"], "spine", subdiv=1)
        prism("pauldron_spike_%d" % side, (0.010, 0.400 * side, 1.250), Vector((0, 1, 0)),
              Vector((0, 0, 1)), Vector((1, 0, 0)),
              [(-0.070, 0.0), (0.070, 0.0), (0.0, 0.115)], 0.070, M["brass"], "spine")

    # neck + head + horned helmet -----------------------------------------
    tube("neck", (0.010, 0.0, 1.200), (0.010, 0.0, 1.265), 0.080, 0.075, 7, M["skin_d"],
         "spine")
    ico("head", (0.020, 0.0, 1.330), 0.120, (1.0, 0.92, 1.0), M["skin"], "head", subdiv=2)
    ico("jaw", (0.078, 0.0, 1.282), 0.076, (1.08, 0.88, 0.82), M["skin_d"], "head", subdiv=1)
    taper_box("helm", (-0.005, 0.0, 1.305), (0.005, 0.0, 1.455), 0.262, 0.262, 0.215, 0.215,
              M["iron"], "head")
    ico("helm_dome", (0.0, 0.0, 1.390), 0.130, (1.0, 1.02, 0.78), M["iron"], "head", subdiv=2)
    # recessed dark visor slot + two hot eyes (the brute's only bright spot)
    box_frame("visor", (0.128, 0.0, 1.336), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.016, 0.105, 0.030, M["iron_d"], "head")
    for side in (-1, 1):
        ico("eye_%d" % side, (0.148, 0.050 * side, 1.338), 0.034, (0.55, 1.05, 0.80),
            M["eye"], "head", subdiv=1)
    box_frame("nasal", (0.140, 0.0, 1.318), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.014, 0.024, 0.052, M["brass"], "head")
    box_frame("helm_brow", (0.128, 0.0, 1.374), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.020, 0.130, 0.022, M["brass"], "head")
    for side in (-1, 1):
        # horns sweep up and back from the helmet sides (silhouette)
        tube("horn_a_%d" % side, (0.0, 0.110 * side, 1.388), (-0.055, 0.200 * side, 1.470),
             0.058, 0.038, 6, M["horn"], "head")
        tube("horn_b_%d" % side, (-0.055, 0.200 * side, 1.470), (-0.130, 0.240 * side, 1.532),
             0.038, 0.008, 6, M["horn"], "head")
    # stubby topknot of hair between the horns
    ico("topknot", (-0.050, 0.0, 1.462), 0.078, (1.0, 1.0, 0.58), M["leather"], "head", subdiv=1)

    # arms -----------------------------------------------------------------
    for side, tag, bone in ((-1, "R", "armR"), (1, "L", "armL")):
        sh = (0.020, 0.300 * side, 1.180)
        el = (0.060, 0.360 * side, 0.960)
        wr = (0.120, 0.350 * side, 0.780)
        tube("upperarm" + tag, sh, el, 0.090, 0.074, 7, M["armor"], bone)
        tube("forearm" + tag, el, wr, 0.076, 0.062, 7, M["armor_d"], bone)
        tube("bracer" + tag, (0.075, 0.357 * side, 0.905), (0.105, 0.351 * side, 0.805),
             0.082, 0.070, 7, M["iron"], bone)
        ico("fist" + tag, (0.128, 0.348 * side, 0.752), 0.078, (1.05, 0.95, 0.95),
            M["leather"], bone, subdiv=2)
        ico("elbow" + tag, el, 0.072, (1.0, 1.0, 1.0), M["iron"], bone, subdiv=1)

    # axe ------------------------------------------------------------------
    hand = Vector((0.128, -0.348, 0.752))
    U = Vector((0.86, 0.0, -0.51)).normalized()
    u, v, n = basis(U, (0, 1, 0))
    AXE = hand + U * 0.64                      # axe head centre, kept above z=0
    tube("haft", tuple(hand - U * 0.26), tuple(hand + U * 0.80), 0.034, 0.030, 7,
         M["leather"], "weapon")
    ico("haft_pommel", tuple(hand - U * 0.275), 0.050, (1, 1, 1), M["iron"], "weapon", subdiv=1)
    for gr in (0.02, 0.10, 0.18):
        tube("haft_wrap_%d" % int(gr * 100), tuple(hand + U * gr),
             tuple(hand + U * (gr + 0.030)), 0.038, 0.038, 7, M["brass"], "weapon")
    # collar where the head meets the haft
    box_frame("axe_collar", tuple(AXE), u, v, n, 0.055, 0.070, 0.062, M["iron"], "weapon")
    # crescent blade: broadside to camera, cutting edge sweeps +v (down/back)
    blade_poly = [
        (-0.140, 0.085), (-0.050, 0.030), (0.060, 0.020), (0.180, 0.040),
        (0.245, 0.130), (0.255, 0.240), (0.180, 0.330), (0.050, 0.360),
        (-0.070, 0.318), (-0.150, 0.205),
    ]
    prism("axe_blade", tuple(AXE), u, v, n, blade_poly, 0.038, M["steel"], "weapon")
    # bright cutting-edge bevel (thin band along the crescent's outer rim)
    bevel_poly = [
        (0.245, 0.130), (0.255, 0.240), (0.180, 0.330), (0.050, 0.360),
        (-0.070, 0.318), (-0.040, 0.300), (0.055, 0.336), (0.165, 0.306),
        (0.222, 0.225), (0.212, 0.135),
    ]
    prism("axe_bevel", tuple(AXE), u, v, n, bevel_poly, 0.042, M["iron_l"], "weapon")
    # back spike opposite the blade
    prism("axe_spike", tuple(AXE), u, v, n,
          [(-0.030, -0.030), (-0.180, -0.090), (-0.280, -0.040), (-0.150, 0.005)],
          0.030, M["iron"], "weapon")

    BASE = {
        "spine": {"ry": 2.0, "rz": -2.0},
        "head": {"ry": -2.0, "rz": 1.0},
        "armR": {"ry": -14.0, "rx": -8.0},
        "armL": {"ry": 14.0, "rx": 8.0},
        "legR": {"ry": 4.0},
        "legL": {"ry": -4.0},
        "weapon": {"ry": 6.0},
    }

    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0, 0.18), "deform": False},
        {"name": "hips", "head": (0, 0, 0.740), "tail": (0, 0, 0.890), "parent": "root"},
        {"name": "spine", "head": (0, 0, 0.890), "tail": (0, 0, 1.210), "parent": "hips",
         "connect": True},
        {"name": "head", "head": (0, 0, 1.210), "tail": (0, 0, 1.500), "parent": "spine",
         "connect": True},
        {"name": "armR", "head": (0.020, -0.300, 1.180), "tail": (0.128, -0.348, 0.752),
         "parent": "spine"},
        {"name": "armL", "head": (0.020, 0.300, 1.180), "tail": (0.128, 0.348, 0.752),
         "parent": "spine"},
        {"name": "legR", "head": (0, -0.115, 0.740), "tail": (0.055, -0.130, 0.140),
         "parent": "hips"},
        {"name": "legL", "head": (0, 0.115, 0.740), "tail": (0.055, 0.130, 0.140),
         "parent": "hips"},
        {"name": "weapon", "head": tuple(hand), "tail": tuple(hand + U * 0.70), "parent": "armR"},
    ]
    cfg = {
        "kind": "brute", "height": height, "render_px": 384, "cell": 96,
        "anchor": (48, 88), "target_px": 52,
    }
    return cfg, bones, "BruteRig", "BruteMesh"


# ============================================================================
# RANGER  - hooded archer, purple-black cloak, longbow
# ============================================================================
def build_ranger():
    global BASE, MOTION, DEATH_F
    height = 1.25
    MOTION = height / 1.70
    DEATH_F = 0.66

    M = {
        "cloak": mat("ra_cloak", (0.215, 0.160, 0.315), rough=0.85, spec=0.2),
        "cloak_d": mat("ra_cloak_d", (0.115, 0.080, 0.175), rough=0.88, spec=0.18),
        "leather": mat("ra_leather", (0.22, 0.16, 0.14), rough=0.72),
        "leather_d": mat("ra_leather_d", (0.235, 0.175, 0.155), rough=0.76),
        "skin": mat("ra_skin", (0.80, 0.66, 0.58), rough=0.60),
        "wood": mat("ra_wood", (0.33, 0.22, 0.13), rough=0.55),
        "string": mat("ra_string", (0.52, 0.50, 0.44), rough=0.65),
        "metal": mat("ra_metal", (0.66, 0.68, 0.72), rough=0.34, metal=0.6),
        "accent": mat("ra_accent", (0.18, 0.44, 0.40), rough=0.5),
        "feather": mat("ra_feather", (0.74, 0.64, 0.36), rough=0.7),
    }

    # legs -----------------------------------------------------------------
    for side, tag in ((-1, "R"), (1, "L")):
        hip = (0.0, 0.075 * side, 0.600)
        knee = (0.025, 0.080 * side, 0.350)
        ankle = (0.040, 0.082 * side, 0.115)
        tube("thigh" + tag, hip, knee, 0.066, 0.049, 7, M["cloak_d"], "leg" + tag)
        ico("knee" + tag, knee, 0.048, (1.0, 0.95, 0.9), M["leather"], "leg" + tag, subdiv=1)
        tube("shin" + tag, knee, ankle, 0.049, 0.036, 7, M["leather_d"], "leg" + tag)
        taper_box("boot" + tag, (0.058, 0.082 * side, 0.0), (0.036, 0.082 * side, 0.145),
                  0.098, 0.190, 0.092, 0.125, M["leather"], "leg" + tag)
        taper_box("bootcuff" + tag, (0.036, 0.082 * side, 0.140), (0.032, 0.082 * side, 0.215),
                  0.092, 0.125, 0.100, 0.115, M["leather_d"], "leg" + tag)

    # torso ----------------------------------------------------------------
    taper_box("pelvis", (0.0, 0.0, 0.590), (0.005, 0.0, 0.700), 0.220, 0.170, 0.205, 0.155,
              M["cloak_d"], "hips")
    taper_box("waist", (0.005, 0.0, 0.695), (0.014, 0.0, 0.820), 0.205, 0.155, 0.215, 0.150,
              M["cloak"], "spine")
    taper_box("chest", (0.014, 0.0, 0.815), (0.025, 0.0, 1.000), 0.215, 0.150, 0.300, 0.170,
              M["cloak"], "spine")
    taper_box("belt", (0.005, 0.0, 0.690), (0.010, 0.0, 0.725), 0.212, 0.162, 0.210, 0.160,
              M["leather"], "hips")
    box_frame("buckle", (0.098, 0.0, 0.708), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.010, 0.026, 0.020, M["metal"], "hips")
    # bandolier
    prism("bandolier", (0.010, 0.0, 0.940), Vector((0.55, 0.0, -0.83)), Vector((0, 1, 0)),
          Vector((0.83, 0.0, 0.55)),
          [(-0.026, -0.175), (0.026, -0.175), (0.026, 0.175), (-0.026, 0.175)],
          0.055, M["leather_d"], "spine")

    # cape (behind, swept back, jagged hem) --------------------------------
    taper_box("cape", (-0.110, 0.0, 0.420), (-0.020, 0.0, 0.995), 0.335, 0.055, 0.235, 0.050,
              M["cloak_d"], "spine")
    taper_box("cape_top", (-0.035, 0.0, 0.985), (-0.010, 0.0, 1.055), 0.250, 0.060, 0.190, 0.055,
              M["cloak"], "spine")
    for i, yy in enumerate((-0.130, -0.043, 0.043, 0.130)):
        prism("cape_jag_%d" % i, (-0.110, yy, 0.425), Vector((0, 1, 0)), Vector((0, 0, 1)),
              Vector((1, 0, 0)),
              [(-0.042, 0.0), (0.042, 0.0), (0.0, -0.075 - 0.02 * (i % 2))],
              0.055, M["cloak_d"], "spine")
    # shoulder mantle
    ico("mantle", (-0.020, 0.0, 1.000), 0.140, (0.62, 1.15, 0.45), M["cloak"], "spine",
        subdiv=2)

    # arms -----------------------------------------------------------------
    for side, tag, bone in ((-1, "R", "armR"), (1, "L", "armL")):
        sh = (0.010, 0.165 * side, 0.985)
        el = (0.050, 0.200 * side, 0.800)
        wr = (0.100, 0.205 * side, 0.655)
        tube("upperarm" + tag, sh, el, 0.050, 0.040, 6, M["cloak"], bone)
        tube("forearm" + tag, el, wr, 0.040, 0.032, 6, M["leather_d"], bone)
        ico("hand" + tag, (0.105, 0.206 * side, 0.638), 0.042, (1.1, 0.9, 1.0),
            M["leather"], bone, subdiv=1)
        tube("cuff" + tag, (0.078, 0.203 * side, 0.700), (0.098, 0.205 * side, 0.660),
             0.046, 0.042, 6, M["accent"], bone)

    # head + hood ----------------------------------------------------------
    ico("head", (0.045, 0.0, 1.095), 0.090, (1.0, 0.92, 1.02), M["skin"], "head", subdiv=2)
    ico("jaw", (0.082, 0.0, 1.056), 0.058, (1.05, 0.88, 0.82), M["skin"], "head", subdiv=1)
    # shadowed eye band + two cold eyes
    prism("eye_band", (0.108, 0.0, 1.112), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.078, 0.016), (0.078, 0.016), (0.072, -0.012), (-0.072, -0.012)],
          0.036, M["cloak_d"], "head")
    for side in (-1, 1):
        ico("eye_%d" % side, (0.122, 0.038 * side, 1.108), 0.022, (0.55, 0.95, 0.70),
            M["accent"], "head", subdiv=1)
    ico("hood", (-0.012, 0.0, 1.106), 0.118, (1.02, 1.05, 1.00), M["cloak"], "head", subdiv=2)
    # hood peak swept back (cone, not a slab: it has to read in silhouette)
    tube("hood_peak", (-0.030, 0.0, 1.160), (-0.180, 0.0, 1.228), 0.076, 0.008, 6,
         M["cloak"], "head")
    # hood rim framing the face
    prism("hood_rim", (0.070, 0.0, 1.132), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.102, 0.028), (0.102, 0.028), (0.092, -0.030), (-0.092, -0.030)],
          0.062, M["cloak_d"], "head")
    # chin strap
    prism("chinstrap", (0.090, 0.0, 1.040), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.052, 0.010), (0.052, 0.010), (0.046, -0.014), (-0.046, -0.014)],
          0.030, M["leather"], "head")

    # quiver + arrows on the near shoulder --------------------------------
    q0 = Vector((-0.130, -0.115, 0.760))
    q1 = Vector((-0.070, -0.150, 1.010))
    tube("quiver", tuple(q0), tuple(q1), 0.058, 0.052, 7, M["leather"], "spine")
    tube("quiver_rim", tuple(q1 - (q1 - q0).normalized() * 0.03), tuple(q1),
         0.061, 0.059, 7, M["metal"], "spine")
    for i, (dy, dz) in enumerate(((-0.022, 0.0), (0.022, 0.004), (0.0, 0.022))):
        a0 = Vector((-0.074 + dy, -0.146 + dz, 0.980))
        a1 = Vector((-0.026 + dy * 1.7, -0.166 + dz, 1.196))
        tube("arrow%d" % i, tuple(a0), tuple(a1), 0.009, 0.009, 4, M["wood"], "spine")
        prism("fletch%d" % i, tuple(a1), Vector((0, 0, 1)), Vector((1, 0, 0)),
              Vector((0, 1, 0)),
              [(0.0, -0.016), (0.072, 0.0), (0.0, 0.016)], 0.012, M["feather"], "spine")

    # longbow in the near hand --------------------------------------------
    hand = Vector((0.105, -0.206, 0.638))
    u = Vector((0.20, 0.0, 0.98)).normalized()     # bow "up" axis, leaning forward
    v = Vector((-0.98, 0.0, 0.20)).normalized()    # forward (belly)
    n = Vector((0.0, 1.0, 0.0))
    half = 0.430
    steps = 11
    outer, inner = [], []
    for i in range(steps):
        t = -1.0 + 2.0 * i / (steps - 1)
        s = t * half
        a = 0.016 + 0.120 * (t * t)          # tips bend forward
        w = 0.044 * (1.0 - 0.58 * t * t)     # limb thickness profile
        outer.append((s, a))
        inner.append((s, a - w))
    prism("bow", tuple(hand), u, v, n, outer + inner[::-1], 0.034, M["wood"], "weapon")
    # riser / grip wrap
    prism("bow_grip", tuple(hand), u, v, n,
          [(-0.055, 0.020), (0.055, 0.020), (0.055, -0.030), (-0.055, -0.030)],
          0.036, M["leather"], "weapon")
    tip_a = hand + u * half + v * 0.136
    tip_b = hand - u * half + v * 0.136
    tube("bowstring", tuple(tip_a), tuple(tip_b), 0.011, 0.011, 4, M["string"], "weapon")

    BASE = {
        "spine": {"ry": 3.0, "rz": -3.0},
        "head": {"ry": -4.0, "rz": 2.0},
        "armR": {"ry": -12.0, "rx": -6.0},
        "armL": {"ry": 10.0, "rx": 6.0},
        "legR": {"ry": 3.0},
        "legL": {"ry": -3.0},
        "weapon": {"ry": 4.0},
    }

    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0, 0.15), "deform": False},
        {"name": "hips", "head": (0, 0, 0.600), "tail": (0, 0, 0.720), "parent": "root"},
        {"name": "spine", "head": (0, 0, 0.720), "tail": (0, 0, 1.005), "parent": "hips",
         "connect": True},
        {"name": "head", "head": (0, 0, 1.005), "tail": (0, 0, 1.235), "parent": "spine",
         "connect": True},
        {"name": "armR", "head": (0.010, -0.165, 0.985), "tail": (0.105, -0.206, 0.638),
         "parent": "spine"},
        {"name": "armL", "head": (0.010, 0.165, 0.985), "tail": (0.105, 0.206, 0.638),
         "parent": "spine"},
        {"name": "legR", "head": (0, -0.075, 0.600), "tail": (0.040, -0.082, 0.115),
         "parent": "hips"},
        {"name": "legL", "head": (0, 0.075, 0.600), "tail": (0.040, 0.082, 0.115),
         "parent": "hips"},
        {"name": "weapon", "head": tuple(hand), "tail": tuple(hand + u * 0.40), "parent": "armR"},
    ]
    cfg = {
        "kind": "ranger", "height": height, "render_px": 384, "cell": 96,
        "anchor": (48, 88), "target_px": 48,
    }
    return cfg, bones, "RangerRig", "RangerMesh"


# ============================================================================
# BOSS  - "Rustmoon Knight": tall plate knight, red cape, greatsword, glow eyes
# ============================================================================
def build_boss():
    global BASE, MOTION, DEATH_F
    height = 2.60
    MOTION = height / 1.70
    DEATH_F = 0.55

    M = {
        "iron": mat("bo_iron", (0.215, 0.205, 0.255), rough=0.42, metal=0.45, spec=0.55),
        "iron_l": mat("bo_iron_l", (0.355, 0.345, 0.420), rough=0.34, metal=0.55, spec=0.6),
        "iron_d": mat("bo_iron_d", (0.125, 0.120, 0.160), rough=0.50, metal=0.4, spec=0.5),
        "brass": mat("bo_brass", (0.72, 0.50, 0.15), rough=0.36, metal=0.75, spec=0.55),
        "cape": mat("bo_cape", (0.520, 0.065, 0.085), rough=0.80, spec=0.25),
        "cape_d": mat("bo_cape_d", (0.320, 0.035, 0.055), rough=0.84, spec=0.22),
        "steel": mat("bo_steel", (0.640, 0.660, 0.740), rough=0.26, metal=0.75, spec=0.65),
        "leather": mat("bo_leather", (0.150, 0.115, 0.110), rough=0.72),
        "rust": mat("bo_rust", (0.470, 0.255, 0.115), rough=0.66, metal=0.25),
    }
    M["eye"] = emissive("bo_eye", (1.0, 0.14, 0.05), 2.6)

    # legs -----------------------------------------------------------------
    for side, tag in ((-1, "R"), (1, "L")):
        hip = (0.0, 0.170 * side, 1.280)
        knee = (0.045, 0.185 * side, 0.700)
        ankle = (0.075, 0.190 * side, 0.200)
        tube("thigh" + tag, hip, knee, 0.135, 0.100, 8, M["iron_d"], "leg" + tag)
        ico("kneecop" + tag, knee, 0.120, (1.0, 0.95, 0.85), M["iron"], "leg" + tag, subdiv=2)
        prism("knee_spike" + tag, (0.115, 0.185 * side, 0.700), Vector((0, 1, 0)),
              Vector((0, 0, 1)), Vector((1, 0, 0)),
              [(-0.070, 0.045), (0.070, 0.045), (0.0, -0.075)], 0.070, M["brass"], "leg" + tag)
        tube("shin" + tag, knee, ankle, 0.108, 0.086, 8, M["iron"], "leg" + tag)
        taper_box("sabaton" + tag, (0.125, 0.190 * side, 0.0), (0.048, 0.190 * side, 0.235),
                  0.225, 0.330, 0.200, 0.255, M["iron"], "leg" + tag)
        prism("toe" + tag, (0.175, 0.190 * side, 0.070), Vector((0, 1, 0)), Vector((0, 0, 1)),
              Vector((1, 0, 0)),
              [(-0.088, 0.075), (0.088, 0.075), (0.062, -0.070), (-0.062, -0.070)],
              0.180, M["iron_l"], "leg" + tag)
        taper_box("greave" + tag, (0.060, 0.188 * side, 0.230), (0.040, 0.186 * side, 0.560),
                  0.200, 0.230, 0.205, 0.225, M["iron_l"], "leg" + tag)
        prism("greave_fin" + tag, (0.040, 0.186 * side, 0.400), Vector((0, 1, 0)),
              Vector((0, 0, 1)), Vector((1, 0, 0)),
              [(-0.050, 0.130), (0.050, 0.130), (0.0, -0.100)], 0.040, M["brass"], "leg" + tag)

    # torso ----------------------------------------------------------------
    taper_box("faulds", (0.0, 0.0, 1.180), (0.005, 0.0, 1.310), 0.560, 0.400, 0.500, 0.360,
              M["iron_d"], "hips")
    taper_box("pelvis", (0.005, 0.0, 1.300), (0.010, 0.0, 1.430), 0.480, 0.330, 0.455, 0.315,
              M["iron"], "hips")
    taper_box("belt", (0.010, 0.0, 1.415), (0.014, 0.0, 1.470), 0.455, 0.320, 0.450, 0.315,
              M["leather"], "hips")
    box_frame("buckle", (0.195, 0.0, 1.442), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.016, 0.060, 0.048, M["brass"], "hips")
    taper_box("waist", (0.014, 0.0, 1.465), (0.020, 0.0, 1.570), 0.450, 0.315, 0.470, 0.310,
              M["iron"], "spine")
    taper_box("chest", (0.020, 0.0, 1.560), (0.052, 0.0, 1.960), 0.470, 0.310, 0.640, 0.360,
              M["iron"], "spine")
    # breastplate details
    for side in (-1, 1):
        ico("pec_%d" % side, (0.100, 0.140 * side, 1.830), 0.165, (0.62, 0.92, 0.85),
            M["iron"], "spine", subdiv=2)
    prism("chest_ridge", (0.192, 0.0, 1.800), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.085, 0.150), (0.085, 0.150), (0.0, -0.135)], 0.090, M["brass"], "spine")
    prism("abdomen_ridge", (0.175, 0.0, 1.630), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.070, 0.070), (0.070, 0.070), (0.0, -0.060)], 0.070, M["rust"], "spine")
    ico("backplate", (-0.185, 0.0, 1.800), 0.180, (0.55, 1.25, 1.00), M["iron_d"],
        "spine", subdiv=2)

    # pauldrons ------------------------------------------------------------
    for side in (-1, 1):
        ico("pauldron_a_%d" % side, (0.0, 0.420 * side, 1.955), 0.235,
            (1.05, 1.12, 0.66), M["iron"], "spine", subdiv=2)
        ico("pauldron_b_%d" % side, (0.0, 0.475 * side, 1.845), 0.195,
            (1.0, 1.05, 0.55), M["iron_l"], "spine", subdiv=2)
        ico("pauldron_c_%d" % side, (0.0, 0.505 * side, 1.735), 0.150,
            (1.0, 1.0, 0.50), M["iron"], "spine", subdiv=1)
        tube("pauldron_spike_%d" % side, (0.010, 0.470 * side, 1.985),
             (-0.020, 0.560 * side, 2.135), 0.052, 0.008, 6, M["brass"], "spine")

    # neck + helm ----------------------------------------------------------
    tube("neck", (0.010, 0.0, 1.945), (0.010, 0.0, 2.020), 0.110, 0.100, 8, M["iron_d"],
         "spine")
    taper_box("gorget", (0.010, 0.0, 1.930), (0.010, 0.0, 1.985), 0.300, 0.280, 0.255, 0.240,
              M["iron_l"], "spine")
    ico("helm", (0.015, 0.0, 2.165), 0.185, (1.0, 1.0, 1.02), M["iron"], "head", subdiv=2)
    taper_box("helm_face", (0.115, 0.0, 2.080), (0.105, 0.0, 2.245), 0.255, 0.170, 0.230, 0.150,
              M["iron"], "head")
    # recessed dark visor + a single glowing slit (the boss's tell)
    box_frame("visor", (0.176, 0.0, 2.165), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.020, 0.120, 0.045, M["iron_d"], "head")
    for side in (-1, 1):
        box_frame("eye_%d" % side, (0.192, 0.062 * side, 2.164), Vector((1, 0, 0)),
                  Vector((0, 1, 0)), Vector((0, 0, 1)), 0.026, 0.048, 0.036, M["eye"], "head")
    # nasal ridge splits the two eyes into a readable "gaze"
    box_frame("nasal_boss", (0.214, 0.0, 2.164), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.020, 0.014, 0.040, M["iron_d"], "head")
    # corner glow: the game camera is a 3/4 SIDE view, so the +X-facing slit is
    # foreshortened to a sliver; this wraps the same glow around the helm corner
    for side in (-1, 1):
        box_frame("eye_corner_%d" % side, (0.150, 0.118 * side, 2.166),
                  Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)),
                  0.034, 0.030, 0.032, M["eye"], "head")
    for side in (-1, 1):
        # cheek vents flanking the eye slit
        prism("vent_%d" % side, (0.196, 0.092 * side, 2.115), Vector((0, 1, 0)),
              Vector((0, 0, 1)), Vector((1, 0, 0)),
              [(-0.030, 0.032), (0.030, 0.032), (0.0, -0.032)], 0.014, M["brass"], "head")
        # crown horns sweeping up and back
        tube("crown_a_%d" % side, (0.0, 0.135 * side, 2.280), (-0.075, 0.245 * side, 2.425),
             0.075, 0.050, 6, M["brass"], "head")
        tube("crown_b_%d" % side, (-0.075, 0.245 * side, 2.425),
             (-0.195, 0.315 * side, 2.525), 0.050, 0.010, 6, M["brass"], "head")
    # crown crest
    prism("crest", (-0.010, 0.0, 2.340), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.052, 0.000), (0.052, 0.000), (0.030, 0.150), (-0.010, 0.205),
           (-0.048, 0.140)], 0.050, M["brass"], "head")
    ico("helm_jewel", (0.175, 0.0, 2.268), 0.042, (0.7, 1.0, 1.0), M["rust"], "head", subdiv=1)

    # arms -----------------------------------------------------------------
    for side, tag, bone in ((-1, "R", "armR"), (1, "L", "armL")):
        sh = (0.020, 0.360 * side, 1.940)
        el = (0.060, 0.440 * side, 1.620)
        wr = (0.130, 0.440 * side, 1.300)
        tube("upperarm" + tag, sh, el, 0.120, 0.098, 8, M["iron_d"], bone)
        ico("elbow" + tag, el, 0.100, (1.0, 1.0, 0.9), M["iron_l"], bone, subdiv=1)
        tube("forearm" + tag, el, wr, 0.100, 0.086, 8, M["iron"], bone)
        taper_box("vambrace" + tag, (0.100, 0.440 * side, 1.400), (0.070, 0.440 * side, 1.560),
                  0.185, 0.190, 0.200, 0.200, M["iron_l"], bone)
        ico("gauntlet" + tag, (0.145, 0.440 * side, 1.265), 0.105, (1.15, 1.0, 0.95),
            M["iron"], bone, subdiv=2)

    # greatsword -----------------------------------------------------------
    hand = Vector((0.135, -0.440, 1.295))
    U = Vector((0.760, 0.0, -0.650)).normalized()
    u, v, n = basis(U, (0, 1, 0))
    tube("grip", tuple(hand - U * 0.230), tuple(hand + U * 0.180), 0.042, 0.040, 8,
         M["leather"], "weapon")
    ico("pommel", tuple(hand - U * 0.255), 0.062, (1, 1, 1), M["brass"], "weapon", subdiv=2)
    box_frame("guard", hand + U * 0.205, u, v, n, 0.055, 0.230, 0.055, M["brass"], "weapon")
    for side in (-1, 1):
        ico("guard_tip_%d" % side, tuple(hand + U * 0.205 + v * (0.230 * side)), 0.036,
            (1, 1, 1), M["brass"], "weapon", subdiv=1)
    # blade: long tapered quad-section blade, broadside to the camera
    sections = [
        (0.250, 0.105, 0.024),
        (0.560, 0.098, 0.021),
        (0.900, 0.078, 0.016),
        (1.150, 0.052, 0.011),
    ]
    verts, faces = [], []
    for t, hw, ht in sections:
        c = hand + U * t
        verts += [tuple(c + v * hw), tuple(c + n * ht), tuple(c - v * hw), tuple(c - n * ht)]
    tip_index = len(verts)
    verts.append(tuple(hand + U * 1.280))
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
    mesh_obj("blade", verts, faces, M["steel"], "weapon")
    # fuller (dark groove) and edge highlight, slightly proud of the blade faces
    prism("fuller", tuple(hand + U * 0.30), u, v, n,
          [(0.0, 0.022), (0.78, 0.016), (0.78, -0.016), (0.0, -0.022)], 0.030,
          M["iron_d"], "weapon")
    prism("edge", tuple(hand + U * 0.30), u, v, n,
          [(0.0, 0.105), (0.80, 0.072), (0.86, 0.030), (0.80, 0.062), (0.0, 0.092)],
          0.026, M["iron_l"], "weapon")

    # cape (sweeps well behind the body so the red reads in a 3/4 side view) --
    taper_box("cape", (-0.300, 0.0, 0.400), (-0.030, 0.0, 1.920),
              0.700, 0.100, 0.400, 0.070, M["cape"], "spine")
    taper_box("cape_mantle", (-0.060, 0.0, 1.880), (-0.020, 0.0, 2.010),
              0.520, 0.090, 0.360, 0.080, M["cape"], "spine")
    for i, yy in enumerate((-0.260, -0.130, 0.0, 0.130, 0.260)):
        prism("cape_jag_%d" % i, (-0.300, yy, 0.405), Vector((0, 1, 0)), Vector((0, 0, 1)),
              Vector((1, 0, 0)),
              [(-0.066, 0.0), (0.066, 0.0), (0.0, -0.140 - 0.03 * (i % 2))],
              0.100, M["cape_d"], "spine")
    # cape folds (dark vertical strips give the cloth some read)
    for i, yy in enumerate((-0.180, 0.180)):
        prism("cape_fold_%d" % i, (-0.215, yy, 1.100), Vector((0, 1, 0)), Vector((0, 0, 1)),
              Vector((1, 0, 0)),
              [(-0.034, 0.0), (0.034, 0.0), (0.034, 0.720), (-0.034, 0.720)],
              0.024, M["cape_d"], "spine")
    # red tabard hanging from the belt over the faulds
    prism("tabard", (0.212, 0.0, 1.160), Vector((0, 0, 1)), Vector((0, 1, 0)),
          Vector((1, 0, 0)),
          [(0.300, -0.145), (0.300, 0.145), (-0.020, 0.160), (-0.140, 0.0),
           (-0.020, -0.160)],
          0.032, M["cape"], "hips")
    prism("tabard_trim", (0.216, 0.0, 1.160), Vector((0, 0, 1)), Vector((0, 1, 0)),
          Vector((1, 0, 0)),
          [(0.300, -0.145), (0.300, 0.145), (0.240, 0.150), (0.240, -0.150)],
          0.030, M["brass"], "hips")

    BASE = {
        "spine": {"ry": 2.0, "rz": -2.0},
        "head": {"ry": -2.0, "rz": 1.0},
        "armR": {"ry": -8.0, "rx": -6.0},
        "armL": {"ry": 12.0, "rx": 8.0},
        "legR": {"ry": 3.0},
        "legL": {"ry": -3.0},
        "weapon": {"ry": 4.0},
    }

    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0, 0.30), "deform": False},
        {"name": "hips", "head": (0, 0, 1.280), "tail": (0, 0, 1.450), "parent": "root"},
        {"name": "spine", "head": (0, 0, 1.450), "tail": (0, 0, 1.960), "parent": "hips",
         "connect": True},
        {"name": "head", "head": (0, 0, 1.960), "tail": (0, 0, 2.360), "parent": "spine",
         "connect": True},
        {"name": "armR", "head": (0.020, -0.360, 1.940), "tail": (0.135, -0.440, 1.295),
         "parent": "spine"},
        {"name": "armL", "head": (0.020, 0.360, 1.940), "tail": (0.135, 0.440, 1.295),
         "parent": "spine"},
        {"name": "legR", "head": (0, -0.170, 1.280), "tail": (0.075, -0.190, 0.200),
         "parent": "hips"},
        {"name": "legL", "head": (0, 0.170, 1.280), "tail": (0.075, 0.190, 0.200),
         "parent": "hips"},
        {"name": "weapon", "head": tuple(hand), "tail": tuple(hand + U * 0.70), "parent": "armR"},
    ]
    cfg = {
        "kind": "boss", "height": height, "render_px": 512, "cell": 160,
        "anchor": (80, 144), "target_px": 112,
    }
    return cfg, bones, "BossRig", "BossMesh"


def build_warden():
    """召唤者 Boss：高瘦长袍 + 法杖，和锈月骑士共用骨架与动作。

    设计意图（和骑士的区分度，按远、中、近三个距离都能一眼认出）：
      * 剪影：没有肩甲/头盔的方肩，换成**兜帽 + 长袍**的垂坠轮廓
      * 材质：紫袍 + 青玉（emissive），不是铁灰 + 赤红
      * 武器：细长法杖 + 发光宝珠，不是巨剑
    骨架沿用 build_boss 的 9 骨/坐标，所以 9 组动作无需重做。
    """
    global BASE, MOTION, DEATH_F
    height = 2.60
    MOTION = height / 1.70
    DEATH_F = 0.55

    M = {
        "robe": mat("wa_robe", (0.300, 0.120, 0.500), rough=0.86, spec=0.18),
        "robe_d": mat("wa_robe_d", (0.170, 0.060, 0.300), rough=0.88, spec=0.15),
        "robe_l": mat("wa_robe_l", (0.430, 0.200, 0.640), rough=0.84, spec=0.2),
        "trim": mat("wa_trim", (0.20, 0.60, 0.52), rough=0.40, metal=0.55, spec=0.5),
        "wood": mat("wa_wood", (0.235, 0.150, 0.095), rough=0.78),
        "skin": mat("wa_skin", (0.050, 0.045, 0.060), rough=0.9),
        "leather": mat("wa_leather", (0.120, 0.095, 0.090), rough=0.78),
    }
    M["glow"] = emissive("wa_glow", (0.30, 1.0, 0.85), 3.2)

    # 长袍：下摆到地面的锥形，三段收腰 -------------------------------------
    taper_box("robe_hem", (0.020, 0.0, 0.010), (0.005, 0.0, 0.760), 0.760, 0.620, 0.560, 0.470,
              M["robe_d"], "hips")
    taper_box("robe_skirt", (0.005, 0.0, 0.740), (0.010, 0.0, 1.320), 0.580, 0.480, 0.430, 0.360,
              M["robe"], "hips")
    prism("robe_split", (0.300, 0.0, 0.030), Vector((0, 0, 1)), Vector((0, 1, 0)),
          Vector((1, 0, 0)),
          [(0.720, -0.075), (0.720, 0.075), (0.0, 0.060), (0.0, -0.060)], 0.030,
          M["robe_d"], "hips")
    taper_box("sash", (0.012, 0.0, 1.290), (0.016, 0.0, 1.400), 0.450, 0.380, 0.440, 0.370,
              M["leather"], "hips")
    box_frame("sash_gem", (0.222, 0.0, 1.345), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.020, 0.055, 0.045, M["glow"], "hips")

    # 躯干：比骑士窄一号 ---------------------------------------------------
    taper_box("torso", (0.016, 0.0, 1.390), (0.030, 0.0, 1.960), 0.420, 0.340, 0.500, 0.330,
              M["robe"], "spine")
    prism("chest_trim", (0.240, 0.0, 1.560), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(0.400, -0.060), (0.400, 0.060), (0.060, 0.080), (0.060, -0.080)], 0.026,
          M["trim"], "spine")
    # 兜帽
    ico("hood", (-0.020, 0.0, 2.150), 0.235, (1.00, 0.95, 1.10), M["robe"], "head", subdiv=2)
    tube("hood_peak", (-0.075, 0.0, 2.285), (-0.190, 0.0, 2.370), 0.105, 0.015, 6,
         M["robe_d"], "head")
    # 兜帽阴影里的脸：只留两颗青光
    ico("face_shadow", (0.135, 0.0, 2.120), 0.140, (1.0, 0.85, 0.95), M["skin"], "head",
        subdiv=2)
    for side in (-1, 1):
        box_frame("eye_%d" % side, (0.235, 0.058 * side, 2.140), Vector((1, 0, 0)),
                  Vector((0, 1, 0)), Vector((0, 0, 1)), 0.020, 0.032, 0.026, M["glow"], "head")
    prism("hood_rim", (0.215, 0.0, 2.230), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.090, 0.010), (0.090, 0.010), (0.070, -0.060), (-0.070, -0.060)], 0.040,
          M["robe_d"], "head")

    # 肩部垂布：让剪影从"方肩骑士"变成"垂肩法师"
    for side in (-1, 1):
        taper_box("drape_%d" % side, (0.010, 0.290 * side, 1.900),
                  (0.050, 0.360 * side, 1.420), 0.360, 0.180, 0.300, 0.150,
                  M["robe_l"], "spine")
        prism("drape_tip_%d" % side, (0.052, 0.360 * side, 1.430), Vector((0, 1, 0)),
              Vector((0, 0, 1)), Vector((1, 0, 0)),
              [(-0.150, 0.010), (0.150, 0.010), (0.0, -0.120)], 0.120,
              M["robe_d"], "spine")

    # 手臂：布袖，比骑士细 ------------------------------------------------
    for side, tag, bone in ((-1, "R", "armR"), (1, "L", "armL")):
        sh = (0.020, 0.300 * side, 1.930)
        el = (0.070, 0.380 * side, 1.640)
        wr = (0.140, 0.380 * side, 1.320)
        tube("sleeve_up" + tag, sh, el, 0.105, 0.085, 8, M["robe"], bone)
        tube("sleeve_low" + tag, el, wr, 0.090, 0.115, 8, M["robe"], bone)
        ico("hand" + tag, wr, 0.070, (1.0, 1.0, 1.05), M["skin"], bone, subdiv=1)

    # 法杖：细杖身 + 顶端宝珠 + 三道爪 ------------------------------------
    hand = Vector((0.135, -0.440, 1.295))
    staff_up = Vector((0.28, 0.0, 0.96)).normalized()
    tube("staff", tuple(hand - staff_up * 0.420), tuple(hand + staff_up * 1.020),
         0.028, 0.022, 6, M["wood"], "weapon")
    tube("staff_collar", tuple(hand + staff_up * 0.980), tuple(hand + staff_up * 1.040),
         0.048, 0.036, 6, M["trim"], "weapon")
    ico("staff_orb", tuple(hand + staff_up * 1.110), 0.105, (1.0, 1.0, 1.0), M["glow"],
        "weapon", subdiv=2)
    u_s, v_s, n_s = basis(staff_up, (0, 1, 0))
    for k in range(3):
        a = math.radians(120 * k)
        d = v_s * math.cos(a) + n_s * math.sin(a)
        tube("staff_prong_%d" % k, tuple(hand + staff_up * 0.995),
             tuple(hand + staff_up * 1.170 + d * 0.115), 0.020, 0.006, 4, M["trim"], "weapon")
    box_frame("staff_ring", tuple(hand + staff_up * 0.760), u_s, v_s, n_s, 0.012, 0.060, 0.060,
              M["trim"], "weapon")

    BASE = {
        "spine": {"ry": 1.0, "rz": -1.0},
        "head": {"ry": -1.0, "rz": 1.0},
        "armR": {"ry": -6.0, "rx": -4.0},
        "armL": {"ry": 10.0, "rx": 6.0},
        "legR": {"ry": 2.0},
        "legL": {"ry": -2.0},
        "weapon": {"ry": 2.0},
    }

    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0, 0.30), "deform": False},
        {"name": "hips", "head": (0, 0, 1.280), "tail": (0, 0, 1.450), "parent": "root"},
        {"name": "spine", "head": (0, 0, 1.450), "tail": (0, 0, 1.960), "parent": "hips",
         "connect": True},
        {"name": "head", "head": (0, 0, 1.960), "tail": (0, 0, 2.360), "parent": "spine",
         "connect": True},
        {"name": "armR", "head": (0.020, -0.300, 1.930), "tail": (0.140, -0.380, 1.320),
         "parent": "spine"},
        {"name": "armL", "head": (0.020, 0.300, 1.930), "tail": (0.140, 0.380, 1.320),
         "parent": "spine"},
        {"name": "legR", "head": (0, -0.170, 1.280), "tail": (0.075, -0.190, 0.200),
         "parent": "hips"},
        {"name": "legL", "head": (0, 0.170, 1.280), "tail": (0.075, 0.190, 0.200),
         "parent": "hips"},
        {"name": "weapon", "head": tuple(hand), "tail": tuple(hand + staff_up * 0.70),
         "parent": "armR"},
    ]
    cfg = {
        "kind": "warden", "height": height, "render_px": 512, "cell": 160,
        "anchor": (80, 144), "target_px": 112,
    }
    return cfg, bones, "WardenRig", "WardenMesh"


def build_berserker():
    """狂战士 Boss：矮壮驼背 + 双刃巨斧，和骑士/召唤者共用骨架与动作。

    区分策略（三种剪影差异最大化）：
      * 骑士：方肩盔甲 + 直立 + 巨剑（细长竖线）
      * 召唤者：兜帽长袍 + 修长 + 法杖（细长斜线）
      * 狂战士：**短腿宽肩 + 前倾驼背 + 双刃斧**（横向宽块，重心低）
    体积感靠肩背的毛皮块和斧面的宽刃，不靠增高。
    """
    global BASE, MOTION, DEATH_F
    height = 2.35
    MOTION = height / 1.70
    DEATH_F = 0.55

    M = {
        "skin": mat("be_skin", (0.330, 0.235, 0.195), rough=0.86),
        "skin_d": mat("be_skin_d", (0.215, 0.145, 0.120), rough=0.88),
        "fur": mat("be_fur", (0.175, 0.150, 0.140), rough=0.92),
        "fur_l": mat("be_fur_l", (0.280, 0.245, 0.220), rough=0.90),
        "iron": mat("be_iron", (0.245, 0.240, 0.265), rough=0.46, metal=0.5, spec=0.5),
        "iron_d": mat("be_iron_d", (0.140, 0.135, 0.155), rough=0.52, metal=0.42),
        "leather": mat("be_leather", (0.185, 0.130, 0.095), rough=0.78),
        "bone": mat("be_bone", (0.640, 0.605, 0.520), rough=0.60),
        "steel": mat("be_steel", (0.560, 0.575, 0.620), rough=0.30, metal=0.72, spec=0.6),
    }
    M["eye"] = emissive("be_eye", (1.0, 0.42, 0.06), 3.0)

    # 短粗腿：站姿外八，重心压得很低 ------------------------------------
    for side, tag in ((-1, "R"), (1, "L")):
        hip = (0.0, 0.235 * side, 1.030)
        knee = (0.030, 0.265 * side, 0.560)
        ankle = (0.055, 0.275 * side, 0.165)
        tube("thigh" + tag, hip, knee, 0.175, 0.150, 8, M["skin_d"], "leg" + tag)
        tube("shin" + tag, knee, ankle, 0.150, 0.130, 8, M["skin"], "leg" + tag)
        taper_box("foot" + tag, (0.095, 0.275 * side, 0.0), (0.045, 0.275 * side, 0.190),
                  0.240, 0.330, 0.215, 0.270, M["leather"], "leg" + tag)
        tube("shinwrap" + tag, (0.055, 0.275 * side, 0.180), (0.040, 0.270 * side, 0.490),
             0.165, 0.150, 8, M["fur"], "leg" + tag)
        ico("kneepad" + tag, knee, 0.130, (1.0, 0.95, 0.85), M["iron_d"], "leg" + tag, subdiv=1)

    # 腰腹：宽、厚，向前挺 ----------------------------------------------
    taper_box("gut", (0.045, 0.0, 0.960), (0.020, 0.0, 1.360), 0.680, 0.520, 0.720, 0.500,
              M["skin"], "hips")
    taper_box("belt", (0.015, 0.0, 1.320), (0.020, 0.0, 1.410), 0.700, 0.510, 0.700, 0.500,
              M["leather"], "hips")
    ico("gut_fur", (0.150, 0.0, 1.180), 0.300, (0.90, 1.05, 0.65), M["fur"], "hips", subdiv=1)

    # 驼背躯干：胸廓前倾，肩部向前压 ------------------------------------
    taper_box("chest", (0.045, 0.0, 1.380), (0.145, 0.0, 1.760), 0.700, 0.500, 0.880, 0.540,
              M["skin"], "spine")
    ico("hump", (-0.115, 0.0, 1.700), 0.320, (1.0, 1.25, 0.80), M["fur_l"], "spine", subdiv=2)
    # 皮毛护肩：把肩线横向拉宽，是"宽块剪影"的关键
    for side in (-1, 1):
        ico("shoulder_fur_%d" % side, (0.030, 0.430 * side, 1.720), 0.300,
            (0.95, 1.10, 0.78), M["fur"], "spine", subdiv=2)
        tube("shoulder_spike_%d" % side, (0.010, 0.430 * side, 1.870),
             (-0.070, 0.520 * side, 1.990), 0.070, 0.010, 6, M["bone"], "spine")

    # 头：小、缩在肩里，两只角 ------------------------------------------
    tube("neck", (0.120, 0.0, 1.700), (0.150, 0.0, 1.800), 0.135, 0.120, 8, M["skin_d"], "spine")
    ico("skull", (0.170, 0.0, 1.930), 0.185, (1.0, 0.95, 0.92), M["skin"], "head", subdiv=2)
    box_frame("jaw", (0.290, 0.0, 1.870), Vector((1, 0, 0)), Vector((0, 1, 0)),
              Vector((0, 0, 1)), 0.075, 0.130, 0.070, M["skin_d"], "head")
    for side in (-1, 1):
        # 獠牙
        prism("tusk_%d" % side, (0.320, 0.080 * side, 1.845), Vector((1, 0, 0)),
              Vector((0, 1, 0)), Vector((0, 0, 1)),
              [(0.0, -0.018), (0.070, 0.0), (0.0, 0.018)], 0.030, M["bone"], "head")
        # 犄角：向前上方弯
        tube("horn_a_%d" % side, (0.140, 0.150 * side, 2.060), (0.260, 0.290 * side, 2.180),
             0.075, 0.050, 6, M["bone"], "head")
        tube("horn_b_%d" % side, (0.260, 0.290 * side, 2.180), (0.380, 0.360 * side, 2.130),
             0.050, 0.012, 6, M["bone"], "head")
        box_frame("eye_%d" % side, (0.320, 0.075 * side, 1.955), Vector((1, 0, 0)),
                  Vector((0, 1, 0)), Vector((0, 0, 1)), 0.022, 0.034, 0.026, M["eye"], "head")

    # 粗壮手臂：比骑士更短更粗，肘部外翻 --------------------------------
    for side, tag, bone in ((-1, "R", "armR"), (1, "L", "armL")):
        sh = (0.070, 0.430 * side, 1.680)
        el = (0.150, 0.510 * side, 1.330)
        wr = (0.250, 0.500 * side, 1.030)
        tube("upperarm" + tag, sh, el, 0.170, 0.145, 8, M["skin"], bone)
        ico("elbow" + tag, el, 0.140, (1.0, 1.0, 0.95), M["skin_d"], bone, subdiv=1)
        tube("forearm" + tag, el, wr, 0.150, 0.130, 8, M["skin"], bone)
        tube("bracer" + tag, (0.180, 0.505 * side, 1.230), (0.250, 0.500 * side, 1.020),
             0.165, 0.150, 8, M["iron_d"], bone)
        ico("fist" + tag, wr, 0.135, (1.0, 1.05, 1.0), M["skin_d"], bone, subdiv=2)

    # 双刃巨斧：短柄 + 两侧大斧面（唯一一套，旧的 prism 版本已删除）----------
    hand = Vector((0.250, -0.500, 1.030))
    U = Vector((0.900, 0.0, 0.300)).normalized()
    tube("haft", tuple(hand - U * 0.300), tuple(hand + U * 0.540), 0.054, 0.048, 8,
         M["leather"], "weapon")
    ico("haft_cap", tuple(hand - U * 0.325), 0.072, (1, 1, 1), M["iron"], "weapon", subdiv=1)
    hub = hand + U * 0.430
    perp = Vector((0.300, 0.0, -0.900)).normalized()   # 垂直于柄、躺在 XZ 平面
    N = Vector((0.0, 1.0, 0.0))
    blade = [(0.05, -0.07), (0.14, 0.16), (0.30, 0.30), (0.44, 0.20),
             (0.48, 0.02), (0.26, -0.14)]
    for sgn in (-1, 1):
        poly = [(x * sgn, y) for x, y in blade]
        prism("axe_blade_%d" % sgn, tuple(hub), perp, U, N, poly, 0.052, M["steel"], "weapon")
    ico("axe_boss", tuple(hub), 0.095, (1, 1, 1), M["iron"], "weapon", subdiv=1)

    BASE = {
        "spine": {"ry": 8.0, "rz": -2.0},
        "head": {"ry": -6.0, "rz": 1.0},
        "armR": {"ry": -10.0, "rx": -8.0},
        "armL": {"ry": 14.0, "rx": 10.0},
        "legR": {"ry": 4.0},
        "legL": {"ry": -4.0},
        "weapon": {"ry": 6.0},
    }

    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0, 0.30), "deform": False},
        {"name": "hips", "head": (0, 0, 1.030), "tail": (0, 0, 1.200), "parent": "root"},
        {"name": "spine", "head": (0, 0, 1.200), "tail": (0, 0, 1.760), "parent": "hips",
         "connect": True},
        {"name": "head", "head": (0, 0, 1.760), "tail": (0, 0, 2.180), "parent": "spine",
         "connect": True},
        {"name": "armR", "head": (0.070, -0.430, 1.680), "tail": (0.250, -0.500, 1.030),
         "parent": "spine"},
        {"name": "armL", "head": (0.070, 0.430, 1.680), "tail": (0.250, 0.500, 1.030),
         "parent": "spine"},
        {"name": "legR", "head": (0, -0.235, 1.030), "tail": (0.055, -0.275, 0.165),
         "parent": "hips"},
        {"name": "legL", "head": (0, 0.235, 1.030), "tail": (0.055, 0.275, 0.165),
         "parent": "hips"},
        {"name": "weapon", "head": tuple(hand), "tail": tuple(hand + U * 0.62),
         "parent": "armR"},
    ]
    cfg = {
        "kind": "berserker", "height": height, "render_px": 512, "cell": 160,
        "anchor": (80, 144), "target_px": 112,
    }
    return cfg, bones, "BerserkerRig", "BerserkerMesh"

def build_shield():
    """盾兵：复用 brute 的重甲几何，左手挂一面大圆盾。

    与 brute 的区分点（远看就能认出"这个要绕后"）：
      * 左手一面朝 +X 的**竖直大圆盾**（正面挡刀的直接视觉暗示）
      * 独立材质 sh_*（冷铁 + 黄铜包边），和 brute 的暖棕甲区分
    右手仍持棒（weapon 骨），所以它也会攻击，只是慢。
    动作沿用 brute 的剪辑集 —— 骨架完全一致，只是多挂了一件几何。
    """
    cfg, bones, rig_name, mesh_name = build_brute()
    cfg = dict(cfg)
    cfg["kind"] = "shield"

    # brute 的左手臂尖（armL tail）就是握盾点
    hand = Vector((0.128, 0.348, 0.752))

    iron = mat("sh_iron", (0.330, 0.335, 0.395), rough=0.42, metal=0.62, spec=0.55)
    iron_d = mat("sh_iron_d", (0.170, 0.175, 0.215), rough=0.50, metal=0.5, spec=0.45)
    trim = mat("sh_trim", (0.640, 0.455, 0.140), rough=0.38, metal=0.68, spec=0.5)

    # 盾面：轴沿 X 的扁圆柱 → 两个圆面正好朝前/朝后
    centre = hand + Vector((0.205, 0.030, 0.045))
    tube("shield_face", tuple(centre - Vector((0.062, 0, 0))),
         tuple(centre + Vector((0.062, 0, 0))), 0.345, 0.330, 10, iron, "armL")
    # 包边：一圈更粗的边环（用略大的扁柱叠在后面）
    tube("shield_rim", tuple(centre - Vector((0.070, 0, 0))),
         tuple(centre + Vector((0.048, 0, 0))), 0.368, 0.352, 10, trim, "armL")
    # 盾心凸钉
    ico("shield_boss", tuple(centre + Vector((0.075, 0, 0))), 0.090, (1, 1, 1),
        iron_d, "armL", subdiv=2)
    # 竖向加强筋：让盾面在 3/4 视角不至于糊成一坨
    for k, dz in enumerate((-0.170, 0.0, 0.170)):
        box_frame("shield_rib_%d" % k, tuple(centre + Vector((0.072, 0, dz))),
                  Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0)),
                  0.016, 0.052, 0.090, iron_d, "armL")
    # 手持处：盾背的把手（朝 -X）
    tube("shield_grip", tuple(hand + Vector((0.10, 0.02, 0.02))),
         tuple(hand + Vector((0.26, 0.02, 0.02))), 0.036, 0.036, 6,
         mat("sh_leather", (0.215, 0.130, 0.075), rough=0.76), "armL")

    return cfg, bones, "ShieldRig", "ShieldMesh"


def build_flyer():
    """飞行敌人：悬空的恶魔翼手。

    设计要点（远看就能认出"这个在天上，得跳起来或扔刀"）：
      * 没有腿 —— 下肢收成一条尾，剪影下半身是锥形而不是两条腿
      * 一对薄膜翅膀绑在 armL/armR 上，靠手臂旋转做扇动
      * 身体是椭圆而不是方块，头部小而前突，两只红眼
      * 整体比地面单位小一圈（height 1.15），因为它悬在 z=34 处

    骨架沿用敌人的 9 骨（root/hips/spine/head/armR/armL/legR/legL/weapon），
    weapon 骨不挂任何几何（它没有武器），这样 clips 能直接复用。
    """
    global BASE, MOTION, DEATH_F
    height = 1.15
    MOTION = height / 1.70
    DEATH_F = 0.72

    M = {
        "hide": mat("fl_hide", (0.290, 0.180, 0.330), rough=0.72),
        "hide_d": mat("fl_hide_d", (0.150, 0.090, 0.190), rough=0.78),
        "hide_l": mat("fl_hide_l", (0.420, 0.280, 0.460), rough=0.68),
        "wing": mat("fl_wing", (0.360, 0.130, 0.250), rough=0.62, spec=0.30),
        "wing_d": mat("fl_wing_d", (0.190, 0.060, 0.140), rough=0.70),
        "bone": mat("fl_bone", (0.700, 0.660, 0.580), rough=0.55),
        "claw": mat("fl_claw", (0.820, 0.790, 0.700), rough=0.40),
    }
    M["eye"] = emissive("fl_eye", (1.0, 0.18, 0.10), 3.4)

    # —— 躯干：椭圆身体，没有腿 ——
    ico("body", (0.010, 0.0, 0.760), 0.260, (1.00, 0.82, 1.15), M["hide"], "spine", subdiv=2)
    ico("chest", (0.060, 0.0, 0.900), 0.185, (0.95, 0.78, 0.90), M["hide_l"], "spine", subdiv=1)
    # 尾：从髋部往下收成尖
    tube("tail_a", (0.0, 0.0, 0.640), (-0.060, 0.0, 0.420), 0.115, 0.070, 6,
         M["hide_d"], "hips")
    tube("tail_b", (-0.060, 0.0, 0.420), (-0.140, 0.0, 0.230), 0.070, 0.014, 5,
         M["hide_d"], "hips")
    # 尾刺
    prism("tail_spike", (-0.140, 0.0, 0.235), Vector((0, 1, 0)), Vector((0, 0, 1)),
          Vector((1, 0, 0)),
          [(-0.030, 0.0), (0.030, 0.0), (0.0, 0.090)], 0.030, M["claw"], "hips")

    # —— 头：小而前突 ——
    ico("skull", (0.150, 0.0, 1.010), 0.150, (1.10, 0.92, 0.92), M["hide"], "head", subdiv=2)
    tube("snout", (0.220, 0.0, 0.985), (0.330, 0.0, 0.955), 0.095, 0.045, 6,
         M["hide_d"], "head")
    # 两只红眼（发光）
    for side in (-1, 1):
        box_frame("eye_%d" % side, (0.255, 0.062 * side, 1.015),
                  Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)),
                  0.020, 0.030, 0.026, M["eye"], "head")
        # 犄角向后弯
        tube("horn_%d" % side, (0.075, 0.085 * side, 1.090),
             (-0.060, 0.140 * side, 1.205), 0.052, 0.010, 5, M["bone"], "head")

    # —— 翅膀：绑在 armL/armR，靠手臂旋转扇动 ——
    # 膜面用 prism 做成扇形，边缘加几根骨刺
    for side, tag, bone in ((-1, "R", "armR"), (1, "L", "armL")):
        root_pt = Vector((0.030, 0.145 * side, 0.930))
        tip_pt = Vector((-0.180, 0.680 * side, 1.060))
        u = (tip_pt - root_pt).normalized()
        v = Vector((0, 0, 1))
        n = u.cross(v).normalized()
        # 主膜：从肩根张到翼尖的扇形
        prism("wing_%s" % tag, tuple(root_pt), u, v, n,
              [(0.0, 0.135), (0.34, 0.180), (0.62, 0.120), (0.86, 0.030),
               (0.86, -0.030), (0.52, -0.075), (0.0, -0.090)],
              0.022, M["wing"], bone)
        # 翼骨：一根粗的 + 两根细的
        tube("wing_arm_%s" % tag, tuple(root_pt), tuple(root_pt + u * 0.86),
             0.036, 0.014, 5, M["bone"], bone)
        for k, frac in enumerate((0.34, 0.62)):
            tube("wing_rib_%d_%s" % (k, tag), tuple(root_pt + u * frac),
                 tuple(root_pt + u * frac + v * (0.16 - k * 0.03) + n * 0.004),
                 0.018, 0.008, 4, M["bone"], bone)
        # 翼尖爪
        tube("wing_claw_%s" % tag, tuple(root_pt + u * 0.84),
             tuple(root_pt + u * 0.99 + v * 0.02), 0.020, 0.006, 4, M["claw"], bone)

    # —— 下肢：收起的爪（视觉上暗示"它没有站立腿"）——
    for side, tag in ((-1, "R"), (1, "L")):
        tube("leg_%s" % tag, (0.010, 0.075 * side, 0.600),
             (-0.040, 0.090 * side, 0.470), 0.075, 0.040, 5, M["hide_d"], "leg" + tag)
        for c in range(3):
            tube("claw_%s_%d" % (tag, c),
                 (-0.040, 0.090 * side, 0.470),
                 (-0.130 - c * 0.02, (0.055 + c * 0.035) * side, 0.430),
                 0.020, 0.005, 4, M["claw"], "leg" + tag)

    # 悬浮姿态：手臂外展让翅膀张开
    BASE = {
        "spine": {"ry": 12.0},
        "head": {"ry": -8.0},
        "armR": {"rz": -18.0, "ry": -10.0},
        "armL": {"rz": 18.0, "ry": 10.0},
        "legR": {"ry": -18.0},
        "legL": {"ry": 18.0},
    }

    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0, 0.18), "deform": False},
        {"name": "hips", "head": (0, 0, 0.640), "tail": (0, 0, 0.760), "parent": "root"},
        {"name": "spine", "head": (0, 0, 0.760), "tail": (0, 0, 0.960), "parent": "hips",
         "connect": True},
        {"name": "head", "head": (0, 0, 0.960), "tail": (0, 0, 1.120), "parent": "spine",
         "connect": True},
        {"name": "armR", "head": (0.030, -0.145, 0.930), "tail": (-0.180, -0.680, 1.060),
         "parent": "spine"},
        {"name": "armL", "head": (0.030, 0.145, 0.930), "tail": (-0.180, 0.680, 1.060),
         "parent": "spine"},
        {"name": "legR", "head": (0.010, -0.075, 0.600), "tail": (-0.040, -0.090, 0.470),
         "parent": "hips"},
        {"name": "legL", "head": (0.010, 0.075, 0.600), "tail": (-0.040, 0.090, 0.470),
         "parent": "hips"},
        # 无武器骨：给个退化定义满足骨架契约（不挂几何）
        {"name": "weapon", "head": (0, 0, 0.9), "tail": (0, 0, 0.95), "parent": "armR"},
    ]
    cfg = {
        "kind": "flyer", "height": height, "render_px": 384, "cell": 96,
        "anchor": (48, 88), "target_px": 40,
    }
    return cfg, bones, "FlyerRig", "FlyerMesh"


def build_crate():
    """补给箱：程序化素材的最后一块 —— 走同一条 Blender 管线。

    造型：木箱 + 铁包角 + 顶部十字补给标记 + 正面一条绿色指示条，
    远看就能认出"这是能捡的东西"。
    只有 idle（轻微浮动）一个姿态，其它剪辑复用 idle 让 pack 管线可用。
    """
    global BASE, MOTION, DEATH_F
    height = 0.55
    MOTION = height / 1.70
    DEATH_F = 1.0

    M = {
        "wood": mat("cr_wood", (0.300, 0.205, 0.115), rough=0.80),
        "wood_d": mat("cr_wood_d", (0.180, 0.120, 0.065), rough=0.84),
        "iron": mat("cr_iron", (0.330, 0.335, 0.360), rough=0.44, metal=0.60, spec=0.5),
        "iron_d": mat("cr_iron_d", (0.175, 0.180, 0.200), rough=0.52, metal=0.5),
        "mark": mat("cr_mark", (0.180, 0.620, 0.320), rough=0.50),
    }
    M["glow"] = emissive("cr_glow", (0.30, 0.90, 0.40), 0.9)

    W = 0.30   # 半宽
    D = 0.24   # 半深
    H = 0.52   # 全高

    # 箱体
    taper_box("crate_body", (0.0, 0.0, 0.0), (0.0, 0.0, H),
              W * 2, D * 2, W * 2, D * 2, M["wood"], "root")
    # 四条竖铁包角
    for sx in (-1, 1):
        for sy in (-1, 1):
            taper_box("crate_corner_%d_%d" % (sx, sy),
                      (sx * (W - 0.012), sy * (D - 0.012), 0.0),
                      (sx * (W - 0.012), sy * (D - 0.012), H),
                      0.030, 0.030, 0.030, 0.030, M["iron"], "root")
    # 上下铁箍
    for z, tag in ((0.035, "lo"), (H - 0.035, "hi")):
        taper_box("crate_band_" + tag, (0.0, 0.0, z), (0.0, 0.0, z + 0.045),
                  W * 2 + 0.014, D * 2 + 0.014, W * 2 + 0.014, D * 2 + 0.014,
                  M["iron_d"], "root")
    # 正面（+X）补给标记：一个十字
    box_frame("crate_cross_v", (W + 0.006, 0.0, H * 0.55),
              Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)),
              0.012, 0.040, 0.200, M["mark"], "root")
    box_frame("crate_cross_h", (W + 0.006, 0.0, H * 0.55),
              Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)),
              0.012, 0.130, 0.045, M["mark"], "root")
    # 顶盖边缘的发光条：暗示"里面有能量"
    box_frame("crate_glow", (0.0, 0.0, H + 0.004),
              Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)),
              0.10, W * 0.55, 0.008, M["glow"], "root")

    BASE = {}   # 静止道具，没有站姿修饰

    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0, 0.20), "deform": False},
        {"name": "hips", "head": (0, 0, 0.20), "tail": (0, 0, 0.32), "parent": "root"},
        {"name": "spine", "head": (0, 0, 0.32), "tail": (0, 0, 0.44), "parent": "hips",
         "connect": True},
        {"name": "head", "head": (0, 0, 0.44), "tail": (0, 0, 0.56), "parent": "spine",
         "connect": True},
        {"name": "armR", "head": (0.06, -0.20, 0.36), "tail": (0.12, -0.26, 0.24),
         "parent": "spine"},
        {"name": "armL", "head": (0.06, 0.20, 0.36), "tail": (0.12, 0.26, 0.24),
         "parent": "spine"},
        {"name": "legR", "head": (0.0, -0.12, 0.20), "tail": (0.04, -0.14, 0.0),
         "parent": "hips"},
        {"name": "legL", "head": (0.0, 0.12, 0.20), "tail": (0.04, 0.14, 0.0),
         "parent": "hips"},
        {"name": "weapon", "head": (0.1, 0, 0.3), "tail": (0.12, 0, 0.34), "parent": "armR"},
    ]
    cfg = {
        "kind": "crate", "height": height, "render_px": 384, "cell": 64,
        "anchor": (32, 56), "target_px": 30,
    }
    return cfg, bones, "CrateRig", "CrateMesh"


BUILDERS = {"grunt": build_grunt, "brute": build_brute,
            "ranger": build_ranger, "shield": build_shield, "flyer": build_flyer,
            "crate": build_crate,
            "boss": build_boss, "warden": build_warden,
            "berserker": build_berserker}


# ============================================================================
# main
# ============================================================================
def main():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", required=True, choices=sorted(BUILDERS))
    args = ap.parse_args(argv)
    kind = args.kind

    cfg, bones, rig_name, mesh_name = BUILDERS[kind]()
    arm = make_armature(rig_name, bones, rig_name)
    mesh = join_and_bind(arm, mesh_name)
    clips = clips_for(kind)
    actions = bake_actions(arm, clips)

    scene_cfg = setup_scene(kind, cfg["height"], cfg["target_px"], cfg["render_px"],
                            cfg["cell"], cfg["anchor"], samples=16)
    scene_cfg["clips"] = {n: {"frames": len(b()), "fps": f, "loop": l}
                          for n, b, f, l, t in clips}

    # measured bounds (rest pose)
    corners = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
    zs = [c.z for c in corners]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    bounds = {"x": [round(min(xs), 3), round(max(xs), 3)],
              "y": [round(min(ys), 3), round(max(ys), 3)],
              "z": [round(min(zs), 3), round(max(zs), 3)]}

    SCENE["art_contract"] = json.dumps(scene_cfg)
    SCENE["enemy_kind"] = kind

    out_blend = os.path.join(OUT_DIR, "%s.blend" % kind)
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out_blend)

    print("SAVED", out_blend)
    print("SUMMARY " + json.dumps({
        "kind": kind,
        "verts": len(mesh.data.vertices),
        "polys": len(mesh.data.polygons),
        "materials": [m.name for m in mesh.data.materials],
        "bones": [b.name for b in arm.data.bones],
        "actions": {n: list(a.frame_range) for n, a in actions.items()},
        "bounds": bounds,
        "height": cfg["height"],
        "render_px": cfg["render_px"],
        "cell": cfg["cell"],
        "anchor": cfg["anchor"],
        "target_px": cfg["target_px"],
        "ortho_scale": round(scene_cfg["ortho_scale"], 4),
        "world_per_px": round(scene_cfg["world_per_px"], 6),
        "cam_target": [round(v, 4) for v in scene_cfg["cam_target"]],
    }))


if __name__ == "__main__":
    main()









