#!/usr/bin/env python3
"""把 ComfyUI 重塑后的高分辨率帧压回像素网格，并贴回 Blender 的原始 alpha。

关键：alpha 必须和 RGB 走**同一套裁剪/缩放/锚点变换**，否则会出现「人物是彩色但轮廓错位」
（实测过：直接拿 pixelize 的裁切结果当 mask，会整帧变黑）。

用法:
    python tools/compose_final.py --restyled tmp/restyled --alpha art-source/blender/hero --out tmp/final
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

CELL_DEFAULT = "96x96"
ANCHOR_DEFAULT = "48,88"
HEIGHT_DEFAULT = 56


def parse_cell(s):
    w, h = s.lower().split("x")
    return int(w), int(h)


def standing_scale(ref_path: Path, height: int, threshold: int) -> float:
    """用一张「站姿参考帧」定死整个角色的缩放。

    为什么不能逐帧按包围盒高度缩放：倒地帧的高度只有站姿的 1/3，逐帧归一化会让角色
    在死亡动画里突然被放大 3 倍（实测宽度冲到 123px 撑爆 96 的 cell）。
    """
    im = Image.open(ref_path).convert("RGBA")
    a = im.getchannel("A").point(lambda v: 255 if v >= threshold else 0)
    bb = a.getbbox()
    if not bb:
        raise ValueError(f"参考帧全透明: {ref_path}")
    return height / (bb[3] - bb[1])


def compose(restyled_path: Path, alpha_path: Path, height: int, cell, anchor, colors: int,
            threshold: int, fixed_scale: float | None = None):
    restyled = Image.open(restyled_path).convert("RGB")
    src = Image.open(alpha_path).convert("RGBA")
    if restyled.size != src.size:
        raise ValueError(f"尺寸不一致: restyled {restyled.size} vs alpha {src.size}")
    alpha = src.getchannel("A").point(lambda a: 255 if a >= threshold else 0)
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError("alpha 全透明")
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0

    scale = fixed_scale if fixed_scale else height / bh
    nw, nh = max(1, round(bw * scale)), max(1, round(bh * scale))
    cw, ch = cell
    if nw > cw:
        raise ValueError(f"缩放后宽度 {nw} 超过 cell {cw}")

    rgb = restyled.crop(bbox).resize((nw, nh), Image.LANCZOS)
    if colors and colors < 256:
        rgb = rgb.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    a = alpha.crop(bbox).resize((nw, nh), Image.NEAREST)

    sprite = rgb.convert("RGBA")
    sprite.putalpha(a)
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    canvas.alpha_composite(sprite, (anchor[0] - nw // 2, anchor[1] - nh))
    return canvas, {"bbox": [x0, y0, x1, y1], "scaled": [nw, nh], "scale": round(scale, 4)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--restyled", required=True)
    ap.add_argument("--alpha", required=True, help="Blender 原始高分辨率帧目录（与 restyled 同结构）")
    ap.add_argument("--out", required=True)
    ap.add_argument("--height", type=int, default=HEIGHT_DEFAULT)
    ap.add_argument("--cell", default=CELL_DEFAULT)
    ap.add_argument("--anchor", default=ANCHOR_DEFAULT)
    ap.add_argument("--colors", type=int, default=32)
    ap.add_argument("--ref", default=None, help="站姿参考帧，用来定死全角色统一缩放（强烈建议传 idle_00）")
    ap.add_argument("--threshold", type=int, default=128)
    args = ap.parse_args()

    cell = parse_cell(args.cell)
    anchor = tuple(int(v) for v in args.anchor.split(","))
    root, alpha_root, out_root = Path(args.restyled), Path(args.alpha), Path(args.out)
    files = sorted(p for p in root.rglob("*.png")
                   if not any(part.startswith(".") for part in p.relative_to(root).parts))
    if not files:
        print(f"错误: {root} 没有 PNG", file=sys.stderr)
        return 2

    fixed = None
    if args.ref:
        try:
            fixed = standing_scale(Path(args.ref), args.height, args.threshold)
        except ValueError as e:
            print(f"错误: {e}", file=sys.stderr)
            return 2
        print(json.dumps({"ref": args.ref, "fixedScale": round(fixed, 4)}, ensure_ascii=False))

    n = 0
    for f in files:
        rel = f.relative_to(root)
        apath = alpha_root / rel
        if not apath.exists():
            print(f"错误: 缺少 alpha 源 {apath}", file=sys.stderr)
            return 2
        try:
            img, _info = compose(f, apath, args.height, cell, anchor, args.colors, args.threshold, fixed)
        except ValueError as e:
            print(f"错误 {f}: {e}", file=sys.stderr)
            return 1
        dst = out_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        img.save(dst)
        n += 1

    print(json.dumps({"restyled": str(root), "alpha": str(alpha_root), "out": str(out_root),
                      "colors": args.colors, "height": args.height, "count": n}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
