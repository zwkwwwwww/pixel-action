#!/usr/bin/env python
"""Verify the Blender hero render pipeline against docs/art-contract.md.

This is the acceptance test for the `tools/blender/` stage. It is intentionally
strict so a missing/partial render fails loudly.

Run with the analysis Python (has Pillow):
    python tools/blender/verify_clips.py

Exit code 0 = all checks pass, 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / "art-source" / "blender" / "hero.blend"
HERO_DIR = ROOT / "art-source" / "blender" / "hero"
CELL_DIR = HERO_DIR / "_cell96"
EVIDENCE = ROOT / "art-source" / "evidence" / "hero-contact-sheet.png"
CHECK_DIR = ROOT / "art-source" / "blender" / "evidence"

RENDER_SIZE = 384
CELL = 96
SUPERSAMPLE = RENDER_SIZE // CELL  # 4

# clip -> (frame_count, fps, loop)
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
REQUIRED_BONES = [
    "root",
    "hips",
    "spine",
    "head",
    "armL",
    "armR",
    "legL",
    "legR",
    "weapon",
]

ALPHA_THRESHOLD = 0.5  # must match render_clips.py
MAX_SEMI_ALPHA_RATIO = 0.02  # full-res AA fringe budget

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"  FAIL: {msg}")


def ok(msg: str) -> None:
    print(f"  ok  : {msg}")


def blender_exe() -> str:
    return os.environ.get("BLENDER_EXE") or (
        r"E:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
    )


def check_blend() -> None:
    print("\n[1] hero.blend structure")
    if not BLEND.exists():
        fail(f"missing {BLEND}")
        return
    proc = subprocess.run(
        [blender_exe(), "-b", str(BLEND), "-P", str(ROOT / "tools/blender/inspect_blend.py")],
        capture_output=True,
        text=True,
        timeout=180,
    )
    line = next((l for l in proc.stdout.splitlines() if l.startswith("BLEND_INFO ")), None)
    if not line:
        fail("could not read BLEND_INFO from Blender; stderr tail: " + proc.stderr[-500:])
        return
    info = json.loads(line[len("BLEND_INFO "):])

    arms = info.get("armatures") or []
    if not arms:
        fail("no armature object in hero.blend")
        return
    bones = arms[0]["bones"]
    missing = [b for b in REQUIRED_BONES if b not in bones]
    if missing:
        fail(f"missing bones: {missing}")
    else:
        ok(f"armature '{arms[0]['name']}' has bones {bones}")

    acts = {a["name"]: a for a in info.get("actions", [])}
    for clip, (n, fps, loop) in CLIPS.items():
        if clip not in acts:
            fail(f"missing action '{clip}'")
            continue
        a = acts[clip]
        if a.get("frame_count") != n:
            fail(f"action {clip}: frame_count prop {a.get('frame_count')} != {n}")
        if a.get("fps") != fps:
            fail(f"action {clip}: fps prop {a.get('fps')} != {fps}")
        if a.get("loop") != loop:
            fail(f"action {clip}: loop prop {a.get('loop')} != {loop}")
        lo, hi = a["frame_range"]
        if int(round(hi - lo)) + 1 != n:
            fail(f"action {clip}: keyframe range {lo}-{hi} does not span {n} frames")
    if all(c in acts for c in CLIPS):
        ok(f"9 actions present: {', '.join(CLIPS)}")

    mesh = (info.get("meshes") or [None])[0]
    if not mesh:
        fail("no mesh object in hero.blend")
    else:
        ok(
            f"mesh '{mesh['name']}': {mesh['verts']} verts, {mesh['polys']} polys, "
            f"{mesh['materials']}, vgroups={mesh['vgroups']}"
        )
        if "ARMATURE" not in mesh["modifiers"]:
            fail("mesh has no armature modifier (not rigged)")

    cams = info.get("cameras") or []
    if not cams:
        fail("no camera")
    else:
        cam = cams[0]
        if cam["type"] != "ORTHO":
            fail(f"camera type is {cam['type']}, expected ORTHO")
        else:
            ok(f"camera '{cam['name']}' ORTHO scale={cam['ortho_scale']:.4f}")
    if info.get("resolution") != [RENDER_SIZE, RENDER_SIZE]:
        fail(f"resolution {info.get('resolution')} != {RENDER_SIZE}x{RENDER_SIZE}")
    if not info.get("film_transparent"):
        fail("film_transparent is False")
    if info.get("engine") not in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        fail(f"unexpected engine {info.get('engine')}")


def check_frames() -> None:
    print("\n[2] rendered frames")
    if not HERO_DIR.exists():
        fail(f"missing {HERO_DIR}")
        return
    for clip, (n, _fps, _loop) in CLIPS.items():
        d = HERO_DIR / clip
        if not d.is_dir():
            fail(f"missing clip dir {d}")
            continue
        pngs = sorted(p.name for p in d.glob("*.png"))
        expected = [f"{clip}_{i:02d}.png" for i in range(n)]
        if pngs != expected:
            fail(f"{clip}: files {pngs} != {expected}")
            continue
        bad = 0
        semi = 0
        for name in expected:
            im = Image.open(d / name)
            if im.size != (RENDER_SIZE, RENDER_SIZE):
                fail(f"{clip}/{name}: size {im.size} != {RENDER_SIZE}^2")
                bad += 1
                continue
            if im.mode != "RGBA":
                fail(f"{clip}/{name}: mode {im.mode} != RGBA")
                bad += 1
                continue
            arr = np.array(im)
            a = arr[..., 3]
            if a[0, 0] or a[0, -1] or a[-1, 0] or a[-1, -1]:
                fail(f"{clip}/{name}: corner alpha not 0 -> background not transparent")
                bad += 1
            bbox = im.getchannel("A").getbbox()
            if bbox is None:
                fail(f"{clip}/{name}: fully transparent frame")
                bad += 1
                continue
            x0, y0, x1, y1 = bbox
            if x0 <= 0 or y0 <= 0 or x1 >= RENDER_SIZE or y1 >= RENDER_SIZE:
                fail(f"{clip}/{name}: silhouette touches frame edge bbox={bbox} (clipped)")
                bad += 1
            semi += int(((a > 0) & (a < 255)).sum())
        if bad == 0:
            ok(f"{clip}: {n} frames {RENDER_SIZE}x{RENDER_SIZE} RGBA, transparent, in-frame")
        total = n * RENDER_SIZE * RENDER_SIZE
        ratio = semi / total
        if ratio > MAX_SEMI_ALPHA_RATIO:
            fail(f"{clip}: semi-transparent AA pixels {ratio:.2%} > {MAX_SEMI_ALPHA_RATIO:.0%}")
        notes.append(f"{clip}: semi-alpha {ratio:.3%}")


def check_silhouette() -> None:
    print("\n[3] standing silhouette size (contract: 56/96 cell px tall)")
    # Only standing clips: attack/special frames legitimately include a raised
    # blade that is much taller than the character.
    for clip in ("idle", "walk"):
        heights = []
        frames = [HERO_DIR / clip / f"{clip}_{i:02d}.png" for i in range(CLIPS[clip][0])]
        if not all(p.exists() for p in frames):
            continue  # reported by [2]
        for p in frames:
            im = Image.open(p).getchannel("A")
            bbox = im.getbbox()
            heights.append(bbox[3] - bbox[1])
        # 56 cell px * 4 = 224 render px, contract tolerance +-2 cell px = +-8
        bad = [h for h in heights if not (216 <= h <= 232)]
        if bad:
            fail(f"{clip}: silhouette heights {heights} outside 216..232 render px")
        else:
            ok(f"{clip}: silhouette heights {heights} (~{sum(heights)//len(heights)/4:.1f} cell px)")


def check_cells() -> None:
    print("\n[4] 96x96 nearest-neighbour cell previews")
    if not CELL_DIR.exists():
        fail(f"missing {CELL_DIR}")
        return
    before = len(failures)
    for clip, (n, _fps, _loop) in CLIPS.items():
        for i in range(n):
            full_p = HERO_DIR / clip / f"{clip}_{i:02d}.png"
            cell_p = CELL_DIR / clip / f"{clip}_{i:02d}.png"
            if not cell_p.exists():
                fail(f"missing cell preview {cell_p}")
                continue
            im = Image.open(cell_p)
            if im.size != (CELL, CELL):
                fail(f"{cell_p.name}: size {im.size} != 96x96")
                continue
            full = np.array(Image.open(full_p))
            want = full[SUPERSAMPLE // 2 :: SUPERSAMPLE, SUPERSAMPLE // 2 :: SUPERSAMPLE].copy()
            keep = int(np.ceil(ALPHA_THRESHOLD * 255))
            want[..., 3] = np.where(want[..., 3] >= keep, 255, 0)
            got = np.array(im)
            if not np.array_equal(got, want):
                d = int((got != want).any(axis=-1).sum())
                fail(f"{cell_p.name}: not exact nearest downsample ({d} px differ)")
    if len(failures) == before:
        ok(f"all {sum(n for n, _, _ in CLIPS.values())} cell previews are exact nearest 4x downscale")


def check_evidence() -> None:
    print("\n[5] evidence images")
    if not EVIDENCE.exists():
        fail(f"missing contact sheet {EVIDENCE}")
    else:
        im = Image.open(EVIDENCE)
        if im.width < 600 or im.height < 600:
            fail(f"contact sheet too small {im.size}")
        else:
            ok(f"contact sheet {EVIDENCE.relative_to(ROOT)} {im.size}")
    for name in ("check_idle_00.png", "check_attack1_02.png"):
        p = CHECK_DIR / name
        if not p.exists():
            fail(f"missing single-frame check {p}")
        else:
            ok(f"single-frame check {name} {Image.open(p).size}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-blend", action="store_true")
    args = ap.parse_args()

    print("=" * 72)
    print("hero render pipeline verification")
    print("=" * 72)
    if not args.skip_blend:
        check_blend()
    check_frames()
    check_silhouette()
    check_cells()
    check_evidence()

    print("\n" + "=" * 72)
    if failures:
        print(f"RESULT: FAIL ({len(failures)} problem(s))")
        for f in failures:
            print(" - " + f)
        return 1
    print("RESULT: PASS - all contract checks green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
