#!/usr/bin/env python
"""Build the per-character review contact sheets.

    python tools/blender/enemies/make_sheets.py
    python tools/blender/enemies/make_sheets.py --kind boss

Reads the cell-sized previews written by tools/blender/enemies/render_clips.py
(which already emulate tools/pixelize.py) and writes:

    art-source/evidence/enemy-<kind>-sheet.png

Top: every frame of every clip on a checkerboard at 3x (boss 2x), so frame
counts, poses, framing, transparency and clipping are all visible at once.
Bottom: a readability strip - the five representative frames at their true
in-game size (1x cell), once on a dark game background and once as pure black
silhouettes, plus a 2x zoom row.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
ENEMY_DIR = ROOT / "art-source" / "blender" / "enemies"
EVIDENCE = ROOT / "art-source" / "evidence"

SPEC = {
    "grunt": (96, 46, "small hunched goblin thief - green rags, short dagger"),
    "brute": (96, 52, "armoured heavy - orange-brown plate, giant axe"),
    "ranger": (96, 48, "hooded archer - purple-black cloak, longbow"),
    "boss": (160, 112, "Rustmoon Knight - tall plate, red cape, greatsword"),
}
CLIPS = [("idle", 4, 8), ("walk", 6, 12), ("attack1", 4, 14), ("attack2", 4, 14),
         ("attack3", 5, 12), ("dodge", 4, 16), ("hurt", 2, 14), ("death", 6, 10),
         ("special", 6, 12)]
HERO_FRAMES = [("idle", 0), ("walk", 0), ("attack1", 2), ("hurt", 1), ("death", 5)]


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


def paste(canvas, im, x, y, scale, bg="checker"):
    im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    if bg == "checker":
        back = checker(im.width, im.height, tile=4 * scale)
    else:
        back = Image.new("RGB", (im.width, im.height), bg)
    back.paste(im, (0, 0), im)
    canvas.paste(back, (x, y))


def alpha_bbox(im):
    return im.getchannel("A").getbbox()


def build(kind):
    cell, height, blurb = SPEC[kind]
    root = ENEMY_DIR / kind
    cell_dir = root / ("_cell%d" % cell)
    sheet = EVIDENCE / ("enemy-%s-sheet.png" % kind)
    report = json.loads((root / "_render_report.json").read_text(encoding="utf-8"))
    frames_total = report["total_frames"]

    scale = 3 if cell == 96 else 2
    cpx = cell * scale
    gap = 8
    label_w = 150
    margin = 20
    cols = max(n for _c, n, _f in CLIPS)
    header_h = 86
    row_h = cpx + 16
    strip_h = cell * 2 + 90
    w = margin * 2 + label_w + cols * (cpx + gap)
    h = header_h + len(CLIPS) * row_h + strip_h + margin
    canvas = Image.new("RGB", (w, h), (22, 23, 27))
    d = ImageDraw.Draw(canvas)
    f_head, f_lab, f_small, f_tiny = font(26), font(19), font(15), font(13)

    d.text((margin, 14), "enemy %s - Blender render contact sheet" % kind, font=f_head,
           fill=(240, 240, 244))
    d.text((margin, 46),
           "%s | %d px visible height, cell %dx%d, anchor (%d,%d) | "
           "%dx%d EEVEE -> cell nearest | ortho yaw 12 pitch -6 | %d clips / %d frames"
           % (blurb, height, cell, cell, cell // 2, cell - 8,
              report["resolution"][0], report["resolution"][1], len(CLIPS), frames_total),
           font=f_small, fill=(158, 160, 170))

    for r, (clip, n, fps) in enumerate(CLIPS):
        y = header_h + r * row_h
        d.rectangle([margin, y, w - margin, y + row_h - 6], fill=(33, 34, 40))
        d.text((margin + 10, y + 16), clip, font=f_lab, fill=(255, 255, 255))
        d.text((margin + 10, y + 42), "%d frames @ %dfps" % (n, fps), font=f_small,
               fill=(150, 152, 164))
        clip_frames = report["clips"].get(clip, {}).get("frames", [])
        aspects = [f["aspect"] for f in clip_frames if f.get("aspect")]
        if aspects:
            d.text((margin + 10, y + 62), "aspect %.2f-%.2f" % (min(aspects), max(aspects)),
                   font=f_tiny, fill=(120, 122, 134))
        for i in range(n):
            p = cell_dir / clip / ("%s_%02d.png" % (clip, i))
            x = margin + label_w + i * (cpx + gap)
            if not p.exists():
                d.text((x, y + 40), "MISSING", font=f_small, fill=(255, 80, 80))
                continue
            im = Image.open(p).convert("RGBA")
            paste(canvas, im, x, y, scale)
            d.text((x + 4, y + cpx - 15), "f%d" % i, font=f_tiny, fill=(240, 220, 120))

    # --- readability strip -------------------------------------------------
    y = header_h + len(CLIPS) * row_h + 12
    d.rectangle([margin, y, w - margin, y + strip_h - 16], fill=(30, 31, 36))
    d.text((margin + 10, y + 10),
           "readability @ true size (1x, %dpx) / silhouette / 2x  -  idle f0, walk f0, attack1 f2, hurt f1, death f5"
           % height, font=f_lab, fill=(230, 230, 236))
    y2 = y + 40
    x = margin + 14
    for j, (clip, i) in enumerate(HERO_FRAMES):
        p = cell_dir / clip / ("%s_%02d.png" % (clip, i))
        if not p.exists():
            continue
        im = Image.open(p).convert("RGBA")
        paste(canvas, im, x, y2, 1, bg=(18, 20, 28))          # 1x on game bg
        bb = alpha_bbox(im)
        d.text((x, y2 + cell + 4), clip, font=f_tiny, fill=(170, 172, 182))
        if bb:
            d.text((x, y2 + cell + 18), "%dx%d" % (bb[2] - bb[0], bb[3] - bb[1]),
                   font=f_tiny, fill=(120, 122, 134))
        # silhouette at 1x
        sx = x + cell + 12
        sil = Image.new("RGBA", im.size, (0, 0, 0, 0))
        sil.paste((8, 8, 10, 255), (0, 0), im)
        paste(canvas, sil, sx, y2, 1, bg=(226, 226, 232))
        # 2x zoom
        paste(canvas, im, sx + cell + 12, y2, 2, bg=(18, 20, 28))
        x = sx + cell + 12 + cell * 2 + 18

    EVIDENCE.mkdir(parents=True, exist_ok=True)
    canvas.save(sheet)
    print("sheet:", sheet, canvas.size)
    return sheet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=sorted(SPEC))
    args = ap.parse_args()
    kinds = [args.kind] if args.kind else list(SPEC)
    for kind in kinds:
        if not (ENEMY_DIR / kind / "_render_report.json").exists():
            print("skip %s: no render report" % kind, file=sys.stderr)
            continue
        build(kind)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
