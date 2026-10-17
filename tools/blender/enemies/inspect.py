#!/usr/bin/env python
"""Zoomed inspection strips for visual QA during authoring.

    python tools/blender/enemies/inspect.py --kind grunt --clips idle,walk,attack1,hurt,death

Writes art-source/blender/enemies/_inspect/<kind>-<clip>.png: the chosen clips,
every frame, at 5x (boss 3x) on a checkerboard. Small enough to read at a
glance, unlike the full contact sheet.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
ENEMY_DIR = ROOT / "art-source" / "blender" / "enemies"
SPEC = {"grunt": (96, 46), "brute": (96, 52), "ranger": (96, 48), "boss": (160, 112)}


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # pragma: no cover
        return ImageFont.load_default()


def checker(w, h, tile=8, a=(58, 58, 66), b=(82, 82, 92)):
    img = Image.new("RGB", (w, h), a)
    d = ImageDraw.Draw(img)
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            if (x // tile + y // tile) % 2 == 0:
                d.rectangle([x, y, x + tile - 1, y + tile - 1], fill=b)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", required=True, choices=sorted(SPEC))
    ap.add_argument("--clips", default="idle,walk,attack1,hurt,death")
    ap.add_argument("--scale", type=int, default=0)
    args = ap.parse_args()

    cell, _height = SPEC[args.kind]
    scale = args.scale or (5 if cell == 96 else 3)
    root = ENEMY_DIR / args.kind / ("_cell%d" % cell)
    report = json.loads((ENEMY_DIR / args.kind / "_render_report.json").read_text(encoding="utf-8"))
    clips = [c.strip() for c in args.clips.split(",") if c.strip()]

    cpx = cell * scale
    rows = len(clips)
    cols = max(len(report["clips"][c]["frames"]) for c in clips)
    margin, label_w, header = 14, 110, 34
    w = margin * 2 + label_w + cols * cpx
    h = header + rows * (cpx + 22) + margin
    canvas = Image.new("RGB", (w, h), (24, 25, 30))
    d = ImageDraw.Draw(canvas)
    d.text((margin, 8), "%s  cell %d  (x%d)" % (args.kind, cell, scale), font=font(17),
           fill=(240, 240, 245))
    for r, clip in enumerate(clips):
        y = header + r * (cpx + 22)
        d.text((margin, y + cpx // 2 - 8), clip, font=font(16), fill=(255, 255, 255))
        frames = report["clips"][clip]["frames"]
        for i, fr in enumerate(frames):
            p = root / clip / ("%s_%02d.png" % (clip, i))
            x = margin + label_w + i * cpx
            if not p.exists():
                continue
            im = Image.open(p).convert("RGBA").resize((cpx, cpx), Image.NEAREST)
            back = checker(cpx, cpx, tile=4 * scale)
            back.paste(im, (0, 0), im)
            canvas.paste(back, (x, y))
            d.text((x + 3, y + cpx + 2), "f%d a%.2f" % (i, fr.get("aspect") or 0),
                   font=font(12), fill=(235, 220, 130))
    out = ENEMY_DIR / "_inspect" / ("%s-%s.png" % (args.kind, "+".join(clips)))
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    print(out, canvas.size)


if __name__ == "__main__":
    main()
