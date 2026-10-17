#!/usr/bin/env python
"""Build the review evidence for the hero render stage.

    python tools/blender/make_evidence.py

Writes:
    art-source/evidence/hero-contact-sheet.png   all 9 clips, every frame, 2x cell
    art-source/blender/evidence/check_idle_00.png     384 px frame + checkerboard + anchor
    art-source/blender/evidence/check_attack1_02.png  same for an attack frame

Uses the 96x96 nearest-downsampled previews from render_clips.py so the sheet
shows exactly what the pixel-art stage will consume.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
HERO = ROOT / "art-source" / "blender" / "hero"
CELL = HERO / "_cell96"
OUT_SHEET = ROOT / "art-source" / "evidence" / "hero-contact-sheet.png"
CHECK_DIR = ROOT / "art-source" / "blender" / "evidence"

CLIPS = [
    ("idle", 4, 8, True),
    ("walk", 6, 12, True),
    ("attack1", 4, 14, False),
    ("attack2", 4, 14, False),
    ("attack3", 5, 12, False),
    ("dodge", 4, 16, False),
    ("hurt", 2, 14, False),
    ("death", 6, 10, False),
    ("special", 6, 12, False),
]
CELL_PX = 96
SCALE = 2


def font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # pragma: no cover - old Pillow
        return ImageFont.load_default()


def checker(w: int, h: int, tile: int = 8, a=(58, 58, 66), b=(82, 82, 92)) -> Image.Image:
    img = Image.new("RGB", (w, h), a)
    d = ImageDraw.Draw(img)
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            if (x // tile + y // tile) % 2 == 0:
                d.rectangle([x, y, x + tile - 1, y + tile - 1], fill=b)
    return img


def paste_cell(canvas: Image.Image, frame_png: Path, x: int, y: int, scale: int = SCALE):
    im = Image.open(frame_png).convert("RGBA")
    if im.size != (CELL_PX, CELL_PX):
        raise SystemExit(f"{frame_png}: expected {CELL_PX}x{CELL_PX}, got {im.size}")
    im = im.resize((CELL_PX * scale, CELL_PX * scale), Image.NEAREST)
    bg = checker(im.width, im.height, tile=4 * scale)
    bg.paste(im, (0, 0), im)
    canvas.paste(bg, (x, y))


def build_sheet():
    f_lab = font(19)
    f_head = font(24)
    f_small = font(15)
    cell = CELL_PX * SCALE
    row_h = cell + 14
    label_w = 168
    cols = max(n for _n, n, _f, _l in CLIPS)
    margin = 18
    header_h = 64
    w = margin * 2 + label_w + cols * (cell + 8)
    h = header_h + margin + len(CLIPS) * row_h + margin
    canvas = Image.new("RGB", (w, h), (26, 27, 32))
    d = ImageDraw.Draw(canvas)
    d.text((margin, 14), "hero — Blender render contact sheet", font=f_head, fill=(238, 238, 242))
    d.text(
        (margin, 42),
        "384x384 EEVEE -> 96x96 nearest (4x supersample) | cell 96, anchor (48,88) | "
        "ortho yaw 12 pitch -6 | 9 clips / 41 frames",
        font=f_small,
        fill=(160, 162, 172),
    )
    for r, (clip, n, fps, loop) in enumerate(CLIPS):
        y = header_h + r * row_h
        d.rectangle([margin, y, w - margin, y + row_h - 6], fill=(34, 35, 42))
        d.text((margin + 10, y + 18), clip, font=f_lab, fill=(255, 255, 255))
        d.text(
            (margin + 10, y + 44),
            f"{n} frames @ {fps}fps" + ("  loop" if loop else ""),
            font=f_small,
            fill=(150, 152, 164),
        )
        d.text((margin + 10, y + 66), f"loop={int(loop)}", font=f_small, fill=(120, 122, 134))
        for i in range(n):
            p = CELL / clip / f"{clip}_{i:02d}.png"
            if not p.exists():
                d.text((margin + label_w + i * (cell + 8), y + 40), "MISSING", font=f_small, fill=(255, 80, 80))
                continue
            paste_cell(canvas, p, margin + label_w + i * (cell + 8), y)
            d.text(
                (margin + label_w + i * (cell + 8) + 4, y + cell - 16),
                f"f{i}",
                font=f_small,
                fill=(240, 220, 120),
            )
    OUT_SHEET.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT_SHEET)
    print("sheet:", OUT_SHEET, canvas.size)


def build_check(clip: str, index: int):
    src = HERO / clip / f"{clip}_{index:02d}.png"
    if not src.exists():
        raise SystemExit(f"missing {src}")
    im = Image.open(src).convert("RGBA")
    scale = 2
    big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    bg = checker(big.width, big.height, tile=8 * scale)
    bg.paste(big, (0, 0), big)
    d = ImageDraw.Draw(bg)
    ax, ay = 48 * 4 * scale, 88 * 4 * scale  # cell anchor (48,88) -> 4x render px
    d.line([ax - 18, ay, ax + 18, ay], fill=(255, 0, 200), width=2)
    d.line([ax, ay - 18, ax, ay + 18], fill=(255, 0, 200), width=2)
    # 96-cell bounds at 4x supersample
    d.rectangle([0, 0, big.width - 1, big.height - 1], outline=(90, 90, 100), width=2)
    d.text((14, 12), f"{clip}_{index:02d}  anchor(48,88) 384px -> magenta cross", font=font(18), fill=(255, 255, 255))
    out = CHECK_DIR / f"check_{clip}_{index:02d}.png"
    CHECK_DIR.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(out)
    print("check:", out, bg.size)


if __name__ == "__main__":
    if not CELL.exists():
        raise SystemExit(f"no cell previews at {CELL}; run render_clips.py first")
    build_sheet()
    build_check("idle", 0)
    build_check("attack1", 2)
    sys.exit(0)
