#!/usr/bin/env python3
"""把 Blender 高分辨率渲染帧压成「硬像素」帧，并按契约摆放锚点。

为什么不用双线性：像素画里 1px 的描边一旦被插值，放大后就是一层灰糊边，风格立刻崩。
所以流程强制为  二值化 alpha → 裁剪 → NEAREST 缩放 → 贴到固定 cell 的锚点上 → 受限调色板。

用法:
    python tools/pixelize.py --in art-source/blender/hero --out tmp/hero-px --height 56
    python tools/pixelize.py --in a.png --out b.png --height 56 --colors 32
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image


def parse_size(s):
    w, h = s.lower().split("x")
    return int(w), int(h)


def pixelize(img: Image.Image, height: int, cell: tuple[int, int], anchor: tuple[int, int],
             colors: int | None, threshold: int) -> tuple[Image.Image, dict]:
    img = img.convert("RGBA")
    alpha = img.getchannel("A").point(lambda a: 255 if a >= threshold else 0)
    img.putalpha(alpha)
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError("整帧透明，可能是渲染时相机没对准角色")
    sprite = img.crop(bbox)
    sw, sh = sprite.size

    scale = height / sh
    nw, nh = max(1, round(sw * scale)), height
    cw, ch = cell
    if nw > cw:
        raise ValueError(f"缩放后宽度 {nw} 超过 cell 宽度 {cw}（原始 {sw}x{sh}）")
    sprite = sprite.resize((nw, nh), Image.NEAREST)

    if colors:
        # 只在 RGB 上做调色板量化，alpha 单独保留，避免边缘出现半透明杂色
        rgb = sprite.convert("RGB")
        q = rgb.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
        a = sprite.getchannel("A")
        sprite = q.convert("RGBA")
        sprite.putalpha(a)

    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    x = anchor[0] - nw // 2
    y = anchor[1] - nh
    canvas.alpha_composite(sprite, (x, y))
    return canvas, {"src": [sw, sh], "scaled": [nw, nh], "scale": round(scale, 4)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--height", type=int, default=56, help="角色最终可见高度（px）")
    ap.add_argument("--cell", default="96x96")
    ap.add_argument("--anchor", default="48,88", help="脚底中心在 cell 内的坐标 x,y")
    ap.add_argument("--colors", type=int, default=0, help="0 = 不量化")
    ap.add_argument("--threshold", type=int, default=128)
    args = ap.parse_args()

    cell = parse_size(args.cell)
    anchor = tuple(int(v) for v in args.anchor.split(","))
    inp, out = Path(args.inp), Path(args.out)

    files = sorted(inp.rglob("*.png")) if inp.is_dir() else [inp]
    if not files:
        print(f"错误: {inp} 里没有 PNG", file=sys.stderr)
        return 2

    report = []
    for f in files:
        rel = f.relative_to(inp) if inp.is_dir() else Path(f.name)
        dst = (out / rel) if inp.is_dir() else out
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            img, info = pixelize(Image.open(f), args.height, cell, anchor, args.colors or None, args.threshold)
        except ValueError as e:
            print(f"错误 {f}: {e}", file=sys.stderr)
            return 1
        img.save(dst)
        report.append({"file": str(rel), **info})

    summary = {
        "in": str(inp), "out": str(out), "height": args.height, "cell": list(cell),
        "anchor": list(anchor), "colors": args.colors, "count": len(report),
        "scales": sorted({r["scale"] for r in report}),
    }
    (out if out.is_dir() else out.parent).mkdir(parents=True, exist_ok=True)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
