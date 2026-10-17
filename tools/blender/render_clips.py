"""Render every hero animation clip to transparent PNG frames.

One command (from the project root):

    blender -b art-source/blender/hero.blend -P tools/blender/render_clips.py -- \
        --out art-source/blender/hero

Produces, for each clip declared in docs/art-contract.md:

    <out>/<clip>/<clip>_00.png ... <clip>_NN.png     384x384 RGBA, film_transparent
    <out>/_cell96/<clip>/<clip>_00.png ...           96x96 nearest 4x downscale

Settings: orthographic camera, yaw 12 / pitch -6, BLENDER_EEVEE, 16 TAA samples,
Standard view transform (flat, saturated colours for pixel art).

Options:
    --out PATH          output root (default: <blend dir>/hero)
    --clips a,b,c       only these clips (default: all)
    --samples N         EEVEE render samples (default 16)
    --no-cell           skip the 96x96 preview downscale
    --alpha-threshold F cell preview: alpha >= F becomes opaque (default 0.5)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import bpy
import numpy as np

# clip name -> (frame_count, fps, loop)   [docs/art-contract.md section 3]
CLIPS = {
    "idle": (4, 8, True),
    "walk": (6, 12, True),
    "attack1": (4, 14, False),
    "attack2": (4, 14, False),
    "attack3": (5, 12, False),
    "dodge": (4, 16, False),
    "hurt": (2, 14, False),
    "death": (6, 10, False),
    "special": (6, 12, False),
}
CELL = 96
SUPERSAMPLE = 4


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    ap.add_argument("--clips", default=None)
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--no-cell", action="store_true")
    ap.add_argument("--alpha-threshold", type=float, default=0.5)
    return ap.parse_args(argv)


def find_armature():
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("no armature in the .blend")
    if len(arms) > 1:
        print("WARNING: multiple armatures, using", arms[0].name)
    return arms[0]


def assign_action(arm, action):
    ad = arm.animation_data or arm.animation_data_create()
    ad.use_nla = False
    ad.action = action
    # Blender 4.4+/5.x slotted actions: bind the armature to the action's slot
    try:
        slots = getattr(action, "slots", None)
        if slots and len(slots):
            ad.action_slot = slots[0]
    except Exception as exc:  # pragma: no cover - API drift guard
        print("  (action_slot bind skipped: %s)" % exc)
    return ad


def load_rgba(path):
    """Load an 8-bit PNG as float RGBA in Blender's bottom-up order, exact bytes."""
    img = bpy.data.images.load(path)
    color = None
    try:
        color = img.colorspace_settings.name
        img.colorspace_settings.name = "Non-Color"
    except Exception:
        pass
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return px


def save_rgba(path, arr_bottom_up, name="cell"):
    h, w, _ = arr_bottom_up.shape
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    try:
        img.colorspace_settings.name = "Non-Color"
    except Exception:
        pass
    img.pixels.foreach_set(arr_bottom_up.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def nearest_cell(full_bottom_up, threshold):
    """Exact 4x nearest downsample to 96x96 + binary alpha (pixel-art edges)."""
    top_down = full_bottom_up[::-1]
    small = top_down[SUPERSAMPLE // 2::SUPERSAMPLE, SUPERSAMPLE // 2::SUPERSAMPLE].copy()
    small[..., 3] = np.where(small[..., 3] >= threshold, 1.0, 0.0)
    return small[::-1]


def main():
    args = parse_args()
    scene = bpy.context.scene
    arm = find_armature()

    if args.out:
        out_root = os.path.abspath(args.out)
    else:
        out_root = os.path.join(os.path.dirname(bpy.data.filepath), "hero")
    os.makedirs(out_root, exist_ok=True)

    cell_root = os.path.join(out_root, "_cell96")

    scene.render.resolution_x = 384
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.use_file_extension = True
    try:
        scene.eevee.taa_render_samples = args.samples
    except Exception:
        pass

    wanted = list(CLIPS)
    if args.clips:
        wanted = [c.strip() for c in args.clips.split(",") if c.strip()]
        unknown = [c for c in wanted if c not in CLIPS]
        if unknown:
            raise SystemExit("unknown clips: %s" % unknown)

    missing = [c for c in wanted if c not in bpy.data.actions]
    if missing:
        raise SystemExit("missing actions in .blend: %s" % missing)

    report = {"blend": bpy.data.filepath, "engine": scene.render.engine,
              "resolution": [384, 384], "samples": args.samples, "clips": {}}
    t_start = time.time()

    print("=" * 70)
    print("render_clips.py  engine=%s  out=%s" % (scene.render.engine, out_root))
    print("=" * 70)

    for clip in wanted:
        n, fps, loop = CLIPS[clip]
        action = bpy.data.actions[clip]
        assign_action(arm, action)
        clip_dir = os.path.join(out_root, clip)
        cell_dir = os.path.join(cell_root, clip)
        os.makedirs(clip_dir, exist_ok=True)
        if not args.no_cell:
            os.makedirs(cell_dir, exist_ok=True)

        t_clip = time.time()
        frames = []
        for i in range(n):
            frame = i + 1
            scene.frame_set(frame)
            path = os.path.join(clip_dir, "%s_%02d.png" % (clip, i))
            scene.render.filepath = path
            t0 = time.time()
            bpy.ops.render.render(write_still=True)
            render_s = time.time() - t0

            px = load_rgba(path)
            alpha = px[..., 3]
            mask = alpha > 0.001
            if mask.any():
                ys, xs = np.nonzero(mask)
                # bbox in top-down pixel coordinates
                y0, y1 = int(ys.min()), int(ys.max())
                x0, x1 = int(xs.min()), int(xs.max())
                bbox = [x0, 383 - y1, x1, 383 - y0]
                height = y1 - y0 + 1
                width = x1 - x0 + 1
            else:
                bbox = None
                height = width = 0

            cell_s = None
            if not args.no_cell:
                cell = nearest_cell(px, args.alpha_threshold)
                cell_path = os.path.join(cell_dir, "%s_%02d.png" % (clip, i))
                t1 = time.time()
                save_rgba(cell_path, cell, name="cell_%s_%d" % (clip, i))
                cell_s = time.time() - t1

            frames.append({
                "frame": frame,
                "file": "%s_%02d.png" % (clip, i),
                "render_s": round(render_s, 3),
                "cell_s": round(cell_s, 3) if cell_s is not None else None,
                "bbox": bbox,
                "content_px": [width, height],
                "alpha_coverage": round(float((alpha > 0.5).mean()), 4),
            })
            print("  %-8s f%d/%d  render %.2fs  bbox=%s %dx%d" %
                  (clip, frame, n, render_s, bbox, width, height))

        elapsed = time.time() - t_clip
        report["clips"][clip] = {
            "frames": frames,
            "fps": fps,
            "loop": loop,
            "count": n,
            "seconds": round(elapsed, 2),
            "seconds_per_frame": round(elapsed / n, 3),
        }
        print("  -> %s: %d frames in %.2fs (%.2fs/frame)" %
              (clip, n, elapsed, elapsed / n))

    total = time.time() - t_start
    report["total_seconds"] = round(total, 2)
    report["total_frames"] = sum(len(v["frames"]) for v in report["clips"].values())
    report["seconds_per_frame"] = round(total / max(1, report["total_frames"]), 3)
    with open(os.path.join(out_root, "_render_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print("=" * 70)
    print("TOTAL %d frames in %.2fs (%.3fs/frame)" %
          (report["total_frames"], total, report["seconds_per_frame"]))
    print("REPORT " + json.dumps({k: report[k] for k in ("total_frames", "total_seconds", "seconds_per_frame")}))


if __name__ == "__main__":
    main()
