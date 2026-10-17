#!/usr/bin/env python3
"""素材总览图：把所有精灵表与背景拼成一张图，供人工目视验收。

用法:
    python tools/contact_sheet.py --out art-source/evidence/contact-sheet.png
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

SPRITES = ["hero", "grunt", "brute", "ranger", "boss"]
BGS = ["bg_level", "bg_boss", "bg_title"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="art-source/evidence/contact-sheet.png")
    ap.add_argument("--scale", type=int, default=2)
    args = ap.parse_args()

    tiles = []
    for name in SPRITES:
        p = Path("assets/sprites") / f"{name}.png"
        if p.exists():
            im = Image.open(p).convert("RGBA")
            tiles.append((f"SPRITE: {name}", im))
    for name in BGS:
        p = Path("assets/bg") / f"{name}.png"
        if p.exists():
            im = Image.open(p).convert("RGBA")
            im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
            tiles.append((f"BG: {name}", im))

    if not tiles:
        print("没有可拼的素材")
        return 2

    pad = 8
    label_h = 14
    W = max(t[1].width for t in tiles) + pad * 2
    H = sum(t[1].height + label_h + pad for t in tiles) + pad
    sheet = Image.new("RGBA", (W, H), (18, 20, 28, 255))

    y = pad
    for label, im in tiles:
        strip = Image.new("RGBA", (W, label_h), (10, 12, 18, 255))
        sheet.alpha_composite(strip, (0, y))
        # 简单标记：标题行用一条亮线代替字体
        bar = Image.new("RGBA", (min(len(label) * 5, W - 10), 5), (200, 170, 90, 255))
        sheet.alpha_composite(bar, (6, y + 4))
        y += label_h
        sheet.alpha_composite(im, (pad, y))
        y += im.height + pad

    out = Path(args.out)
    if args.scale > 1:
        sheet = sheet.resize((sheet.width * args.scale, sheet.height * args.scale), Image.NEAREST)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(json.dumps({"out": str(out), "tiles": len(tiles), "size": list(sheet.size)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
