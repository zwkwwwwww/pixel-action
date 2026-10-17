"""Render every enemy animation clip to transparent PNG frames.

One command per character (from the project root):

    blender -b art-source/blender/enemies/grunt.blend \
        -P tools/blender/enemies/render_clips.py -- --out art-source/blender/enemies/grunt

Produces, for each of the 9 contract clips (docs/art-contract.md section 3):

    <out>/<clip>/<clip>_00.png ...                   384x384 RGBA (boss 512x512)
    <out>/_cell<cell>/<clip>/<clip>_00.png ...        cell-sized pixel preview
    <out>/_render_report.json                        per-frame bbox / timing

The cell preview is an exact emulation of tools/pixelize.py: binary alpha at
0.5, crop to the silhouette bbox, NEAREST resize to the character's contract
visible height, paste on the contract anchor.  So the previews show what the
pixel-art stage will actually consume.

Character-specific numbers (render size, cell, anchor, visible height,
orthographic scale) are read from the scene property `art_contract`, written by
tools/blender/enemies/build_enemies.py.

Options:
    --out PATH          output root (default: <blend dir>/<kind>)
    --clips a,b,c       only these clips (default: all 9)
    --samples N         EEVEE render samples (default 16)
    --no-cell           skip the cell-sized previews
    --alpha-threshold F preview: alpha >= F becomes opaque (default 0.5)
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


def scene_contract():
    raw = bpy.context.scene.get("art_contract")
    if not raw:
        raise SystemExit("scene has no art_contract property; rebuild with build_enemies.py")
    return json.loads(raw)


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
    try:
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


def cell_preview(px_bottom_up, target_h, cell, anchor, threshold):
    """tools/pixelize.py emulation: crop -> NEAREST -> anchor. Returns (array, meta)."""
    top = px_bottom_up[::-1]                     # top-down view
    alpha = top[..., 3]
    mask = alpha >= threshold
    if not mask.any():
        return None, None
    ys, xs = np.nonzero(mask)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    sprite = top[y0:y1, x0:x1]
    sh, sw = sprite.shape[:2]
    nw = max(1, int(round(sw * target_h / float(sh))))

    yi = np.clip((np.arange(target_h) * sh // target_h), 0, sh - 1)
    xi = np.clip((np.arange(nw) * sw // nw), 0, sw - 1)
    small = sprite[yi][:, xi].copy()

    canvas = np.zeros((cell, cell, 4), np.float32)
    left = anchor[0] - nw // 2
    top_y = anchor[1] - target_h
    # clip against the cell (should not happen for a valid sprite)
    sx0 = max(0, -left)
    sy0 = max(0, -top_y)
    dx0 = max(0, left)
    dy0 = max(0, top_y)
    cw = min(nw - sx0, cell - dx0)
    ch = min(target_h - sy0, cell - dy0)
    if cw > 0 and ch > 0:
        canvas[dy0:dy0 + ch, dx0:dx0 + cw] = small[sy0:sy0 + ch, sx0:sx0 + cw]
    canvas[..., 3] = np.where(canvas[..., 3] >= threshold, 1.0, 0.0)
    meta = {"crop": [sw, sh], "scaled": [nw, target_h], "scale": round(target_h / sh, 4),
            "clipped": bool(left < 0 or top_y < 0 or left + nw > cell or top_y + target_h > cell)}
    return canvas[::-1], meta        # back to bottom-up for Blender


def main():
    args = parse_args()
    scene = bpy.context.scene
    arm = find_armature()
    cfg = scene_contract()

    render_px = int(cfg["render_px"])
    cell = int(cfg["cell"])
    anchor = tuple(int(v) for v in cfg["anchor"])
    target_px = int(cfg["target_px"])
    kind = cfg["kind"]

    if args.out:
        out_root = os.path.abspath(args.out)
    else:
        out_root = os.path.join(os.path.dirname(bpy.data.filepath), kind)
    os.makedirs(out_root, exist_ok=True)
    cell_root = os.path.join(out_root, "_cell%d" % cell)

    scene.render.resolution_x = render_px
    scene.render.resolution_y = render_px
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

    report = {"blend": bpy.data.filepath, "kind": kind, "engine": scene.render.engine,
              "resolution": [render_px, render_px], "cell": cell, "anchor": list(anchor),
              "target_px": target_px, "samples": args.samples,
              "ortho_scale": cfg.get("ortho_scale"), "clips": {}}
    t_start = time.time()

    print("=" * 70)
    print("render_clips.py  kind=%s  engine=%s  %dx%d -> cell %d (target %d px)"
          % (kind, scene.render.engine, render_px, render_px, cell, target_px))
    print("=" * 70)

    for clip in wanted:
        n, fps, loop = CLIPS[clip]
        action = bpy.data.actions[clip]
        have = action.get("frame_count", n)
        if have < n:
            raise SystemExit("action %s has %s frames, contract wants %d" % (clip, have, n))
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
                y0, y1 = int(ys.min()), int(ys.max())
                x0, x1 = int(xs.min()), int(xs.max())
                bbox = [x0, render_px - 1 - y1, x1, render_px - 1 - y0]
                height = y1 - y0 + 1
                width = x1 - x0 + 1
            else:
                bbox, height, width = None, 0, 0

            cell_s = None
            preview_meta = None
            if not args.no_cell:
                cell_px, preview_meta = cell_preview(px, target_px, cell, anchor,
                                                     args.alpha_threshold)
                cell_path = os.path.join(cell_dir, "%s_%02d.png" % (clip, i))
                t1 = time.time()
                if cell_px is not None:
                    save_rgba(cell_path, cell_px, name="cell_%s_%d" % (clip, i))
                cell_s = time.time() - t1

            frames.append({
                "frame": frame,
                "file": "%s_%02d.png" % (clip, i),
                "render_s": round(render_s, 3),
                "cell_s": round(cell_s, 3) if cell_s is not None else None,
                "bbox": bbox,
                "content_px": [width, height],
                "aspect": round(width / height, 3) if height else None,
                "alpha_coverage": round(float((alpha > 0.5).mean()), 4),
                "cell": preview_meta,
            })
            print("  %-8s f%d/%d  render %.2fs  bbox=%s %dx%d aspect %.2f" %
                  (clip, frame, n, render_s, bbox, width, height,
                   (width / height if height else 0)))

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
    all_aspects = [f["aspect"] for v in report["clips"].values() for f in v["frames"]
                   if f["aspect"]]
    report["aspect_range"] = [min(all_aspects), max(all_aspects)] if all_aspects else None
    with open(os.path.join(out_root, "_render_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print("=" * 70)
    print("TOTAL %d frames in %.2fs (%.3fs/frame)  aspect %.2f..%.2f (cell limit %.2f)" %
          (report["total_frames"], total, report["seconds_per_frame"],
           (report["aspect_range"] or [0, 0])[0], (report["aspect_range"] or [0, 0])[1],
           cell / float(target_px)))
    print("REPORT " + json.dumps({k: report[k] for k in
                                  ("total_frames", "total_seconds", "seconds_per_frame",
                                   "aspect_range")}))


if __name__ == "__main__":
    main()
