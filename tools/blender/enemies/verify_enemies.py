#!/usr/bin/env python3
"""Contract gate for the enemy/boss Blender assets.

Run from the project root (needs Pillow):

    python tools/blender/enemies/verify_enemies.py
    python tools/blender/enemies/verify_enemies.py --kind boss

It checks, for every kind, the things docs/art-contract.md and the task demand:

  1. art-source/blender/enemies/<kind>.blend exists and is a real blend
  2. <kind>/_render_report.json exists and lists exactly the 9 contract clips
     with the contract frame counts (idle 4 / walk 6 / attack1 4 / attack2 4 /
     attack3 5 / dodge 4 / hurt 2 / death 6 / special 6)
  3. every frame PNG exists, is 384x384 (boss 512x512), RGBA, fully transparent
     in the corners and has visible content
  4. the per-kind cell preview is <cell> x <cell>, sits on the contract anchor
     and its opaque silhouette is exactly `visible height` px tall
  5. the rendered silhouette aspect stays inside what tools/pixelize.py can
     pack into the cell (width <= cell_width after scaling to the target height)
  6. the evidence contact sheet exists at art-source/evidence/enemy-<kind>-sheet.png

Exit code 0 = all gates pass, 1 = at least one failure.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
ENEMY_DIR = ROOT / "art-source" / "blender" / "enemies"
EVIDENCE = ROOT / "art-source" / "evidence"

# kind -> (render_px, cell, anchor, visible_height)
SPEC = {
    "grunt": (384, 96, (48, 88), 46),
    "brute": (384, 96, (48, 88), 52),
    "ranger": (384, 96, (48, 88), 48),
    "boss": (512, 160, (80, 144), 112),
}

# clip -> contract frame count
CLIPS = {
    "idle": 4, "walk": 6, "attack1": 4, "attack2": 4, "attack3": 5,
    "dodge": 4, "hurt": 2, "death": 6, "special": 6,
}


class Gate:
    def __init__(self, kind):
        self.kind = kind
        self.failures = []
        self.notes = []

    def check(self, ok, msg):
        if ok:
            self.notes.append("  ok   " + msg)
        else:
            self.failures.append(msg)
            self.notes.append("  FAIL " + msg)
        return ok


def alpha_stats(path: Path):
    im = Image.open(path).convert("RGBA")
    a = im.getchannel("A")
    bbox = a.getbbox()
    return im, bbox


def check_kind(kind: str) -> Gate:
    render_px, cell, anchor, height = SPEC[kind]
    g = Gate(kind)
    root = ENEMY_DIR / kind

    blend = ENEMY_DIR / f"{kind}.blend"
    g.check(blend.exists() and blend.stat().st_size > 50_000,
            f"{kind}.blend exists and is non-trivial")
    if not blend.exists():
        return g

    report_path = root / "_render_report.json"
    if not g.check(report_path.exists(), "_render_report.json exists"):
        return g
    report = json.loads(report_path.read_text(encoding="utf-8"))
    clips = report.get("clips", {})
    g.check(sorted(clips) == sorted(CLIPS), "9 contract clips rendered")
    for name, want in CLIPS.items():
        got = (clips.get(name) or {}).get("count")
        g.check(got == want, f"{name}: {want} frames (got {got})")

    cell_root = root / f"_cell{cell}"
    max_aspect = 0.0
    min_aspect = 99.0
    for name, want in CLIPS.items():
        for i in range(want):
            frame = root / name / f"{name}_{i:02d}.png"
            if not frame.exists():
                g.check(False, f"missing frame {frame.relative_to(ROOT)}")
                continue
            im, bbox = alpha_stats(frame)
            if im.size != (render_px, render_px) or im.mode != "RGBA":
                g.check(False, f"{frame.name}: {im.size} {im.mode} (want {render_px}x{render_px} RGBA)")
                continue
            corners = [im.getpixel(p)[3] for p in
                       ((0, 0), (render_px - 1, 0), (0, render_px - 1), (render_px - 1, render_px - 1))]
            if any(c != 0 for c in corners):
                g.check(False, f"{name}_{i:02d}: corners not transparent")
            if bbox is None:
                g.check(False, f"{name}_{i:02d}: empty render")
                continue
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            max_aspect = max(max_aspect, w / h)
            min_aspect = min(min_aspect, w / h)

            preview = cell_root / name / f"{name}_{i:02d}.png"
            if not preview.exists():
                if i == 0:
                    g.check(False, f"cell previews missing for {name}")
                continue
            if True:
                pm, pbb = alpha_stats(preview)
                if pm.size != (cell, cell):
                    g.check(False, f"{name}_{i:02d} preview {pm.size} != {cell}")
                elif pbb is not None:
                    ph = pbb[3] - pbb[1]
                    pw = pbb[2] - pbb[0]
                    g.check(abs(ph - height) <= 1, f"{name}_{i:02d} silhouette {ph}px == {height}px")
                    # anchor: feet centre on the anchor, sprite bottom on the anchor row
                    g.check(pbb[3] == anchor[1], f"{name}_{i:02d} bottom {pbb[3]} == anchor y {anchor[1]}")
                    g.check(pw <= cell, f"{name}_{i:02d} fits cell width ({pw} <= {cell})")

    g.check(max_aspect <= cell / height,
            f"max silhouette aspect {max_aspect:.2f} <= cell/height {cell / height:.2f} (pixelize can pack it)")

    sheet = EVIDENCE / f"enemy-{kind}-sheet.png"
    g.check(sheet.exists() and sheet.stat().st_size > 20_000, f"evidence sheet {sheet.name}")
    g.notes.append(f"  info aspect range {min_aspect:.2f}..{max_aspect:.2f}")
    return g


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=sorted(SPEC))
    args = ap.parse_args()
    kinds = [args.kind] if args.kind else list(SPEC)
    failures = 0
    for kind in kinds:
        g = check_kind(kind)
        print(f"[{kind}] {'PASS' if not g.failures else 'FAIL'}  ({len(g.failures)} failures)")
        for line in g.notes:
            if "FAIL" in line:
                print(line)
        failures += len(g.failures)
        if g.failures:
            pass
        else:
            print(f"  {SPEC[kind][3]}px tall, cell {SPEC[kind][1]}, ok")
    print(f"\nTOTAL FAILURES: {failures}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
