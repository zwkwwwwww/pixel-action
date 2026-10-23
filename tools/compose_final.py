#!/usr/bin/env python3
"""把 ComfyUI 重塑后的高分辨率帧压回像素网格，并贴回 Blender 的原始 alpha。

关键：alpha 必须和 RGB 走**同一套裁剪/缩放/锚点变换**，否则会出现「人物是彩色但轮廓错位」
（实测过：直接拿 pixelize 的裁切结果当 mask，会整帧变黑）。

v2 的两个修正（都在 pivot_drift.py 的闸门下验证）：

1. **固定裁剪框，而不是逐帧 bbox**。
   旧实现把「每帧可见内容的中心」钉在锚点，任何非对称伸展（挥剑/倒地/抬手）都会把身体
   推离锚点：hero attack2 实测漂移 17.5px，而碰撞盒用的是固定锚点 → 可见身体与判定框错位。
   现在先用全部帧的 alpha 并集算出一个**固定裁剪框**（以站姿参考帧的根节点为中心），
   所有帧共用同一个框，根节点恒映射到 anchor[0] → 横向漂移恒为 0。

2. **预乘 alpha 下采样**。
   旧实现直接把 RGB 用 LANCZOS 缩到像素网格，会把轮廓外的 AI 铺底灰（40,42,52）平均进
   最外圈实心像素（实测外圈色差 22.3、4–5% 环像素被污染）。现在先乘 alpha 再按面积
   （BOX）下采样、再反预乘，轮廓外颜色不再渗出；同时 LANCZOS 改为 BOX ——
   art-contract.md 第 17 条本就禁止插值。

用法:
    python tools/compose_final.py --restyled tmp/restyled --alpha art-source/blender/hero --out tmp/final \
        --height 56 --cell 96x96 --anchor 48,88 --colors 32 --ref art-source/blender/hero/idle/idle_00.png
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

CELL_DEFAULT = "96x96"
ANCHOR_DEFAULT = "48,88"
HEIGHT_DEFAULT = 56


def parse_cell(s):
    w, h = s.lower().split("x")
    return int(w), int(h)


def alpha_mask(im: Image.Image, threshold: int) -> Image.Image:
    return im.convert("RGBA").getchannel("A").point(lambda v: 255 if v >= threshold else 0)


def bbox_of(path: Path, threshold: int) -> tuple[int, int, int, int]:
    bb = alpha_mask(Image.open(path), threshold).getbbox()
    if not bb:
        raise ValueError(f"全透明帧: {path}")
    return bb


def plan_box(frames: list[Path], ref: Path, height: int, cell, threshold: int) -> dict:
    """算一个所有帧共用的固定裁剪框（以站姿参考帧的根节点为中心）。"""
    boxes = [bbox_of(f, threshold) for f in frames]
    ref_idx = frames.index(ref) if ref in frames else 0
    rx0, ry0, rx1, ry1 = boxes[ref_idx]
    scale = height / (ry1 - ry0)
    feet_y = float(ry1)
    root_x = (rx0 + rx1) / 2.0

    cw, ch = cell
    half = max(max(root_x - bb[0], bb[2] - root_x) for bb in boxes)
    half = max(1.0, min(half, (cw / scale) / 2.0))          # 保证缩放后宽度装得进 cell
    top = min(bb[1] for bb in boxes)
    top = max(top, feet_y - ch / scale)                      # 保证缩放后高度装得进 cell

    w, h = Image.open(frames[0]).size
    left = max(0, int(np.floor(root_x - half)))
    right = min(w, int(np.ceil(root_x + half)))
    top_i = max(0, int(np.floor(top)))
    bottom = min(h, int(np.ceil(feet_y)))
    if right - left < 2 or bottom - top_i < 2:
        raise ValueError("裁剪框退化")
    return {
        "box": (left, top_i, right, bottom),
        "scale": scale,
        "feetY": feet_y,
        "rootX": root_x,
    }


def downscale_premultiplied(rgb: Image.Image, alpha: Image.Image, size) -> tuple[Image.Image, Image.Image]:
    """预乘 alpha 的按面积下采样：轮廓外的颜色不会渗进边缘像素。"""
    rgb_np = np.asarray(rgb.convert("RGB"), dtype=np.float32)
    a_np = np.asarray(alpha, dtype=np.float32)
    pre = np.clip(rgb_np * (a_np[..., None] / 255.0), 0, 255).astype(np.uint8)

    pre_img = Image.fromarray(pre, mode="RGB").resize(size, Image.BOX)
    a_img = alpha.resize(size, Image.BOX)

    pre_out = np.asarray(pre_img, dtype=np.float32)
    a_out = np.asarray(a_img, dtype=np.float32)
    denom = np.maximum(a_out[..., None], 1e-6)
    rgb_out = np.clip(pre_out * (255.0 / denom), 0, 255).astype(np.uint8)
    rgb_out[a_out < 1] = 0
    return Image.fromarray(rgb_out, mode="RGB"), Image.fromarray(np.clip(a_out, 0, 255).astype(np.uint8), mode="L")


def compose(restyled_path: Path, alpha_path: Path, cell, anchor, colors: int, threshold: int,
            plan: dict, legacy_bbox: bool = False, palette_img: Image.Image | None = None):
    restyled = Image.open(restyled_path).convert("RGB")
    src = Image.open(alpha_path).convert("RGBA")
    if restyled.size != src.size:
        raise ValueError(f"尺寸不一致: restyled {restyled.size} vs alpha {src.size}")

    cw, ch = cell
    scale = plan["scale"]

    def _quantize(rgb: Image.Image) -> Image.Image:
        """优先用全局调色板（跨 sprite/跨帧一致）；否则退回逐帧量化。"""
        if palette_img is not None:
            return rgb.quantize(palette=palette_img, dither=Image.Dither.NONE).convert("RGB")
        if colors and colors < 256:
            return rgb.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
        return rgb

    if legacy_bbox:
        # 旧行为，仅用于 A/B 对比与回退
        a = alpha_mask(src, threshold)
        bb = a.getbbox()
        if not bb:
            raise ValueError("alpha 全透明")
        x0, y0, x1, y1 = bb
        nw, nh = max(1, round((x1 - x0) * scale)), max(1, round((y1 - y0) * scale))
        if nw > cw:
            raise ValueError(f"缩放后宽度 {nw} 超过 cell {cw}")
        rgb = _quantize(restyled.crop(bb).resize((nw, nh), Image.LANCZOS))
        aa = a.crop(bb).resize((nw, nh), Image.NEAREST)
        sprite = rgb.convert("RGBA")
        sprite.putalpha(aa)
        canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        paste_y = anchor[1] - round((y1 - y0) * scale)
        canvas.alpha_composite(sprite, (anchor[0] - nw // 2, paste_y))
        return canvas, {"mode": "legacy", "scaled": [nw, nh], "scale": round(scale, 4)}

    left, top, right, bottom = plan["box"]
    nw = max(1, round((right - left) * scale))
    nh = max(1, round((bottom - top) * scale))
    if nw > cw:
        raise ValueError(f"缩放后宽度 {nw} 超过 cell {cw}")

    rgb_crop = restyled.crop((left, top, right, bottom))
    alpha_crop = alpha_mask(src, threshold).crop((left, top, right, bottom))
    rgb, a_small = downscale_premultiplied(rgb_crop, alpha_crop, (nw, nh))
    rgb = _quantize(rgb)

    sprite = rgb.convert("RGBA")
    sprite.putalpha(a_small.point(lambda v: 255 if v >= threshold else 0))
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))

    # 根节点恒映射到锚点：所有帧同一个裁剪框、同一个缩放 → 横向漂移恒为 0
    root_in_box = (plan["rootX"] - left) * scale
    paste_x = int(round(anchor[0] - root_in_box))
    paste_y = anchor[1] - nh
    canvas.alpha_composite(sprite, (paste_x, paste_y))
    return canvas, {
        "mode": "fixed-box", "box": [left, top, right, bottom],
        "scaled": [nw, nh], "scale": round(scale, 4),
        "paste": [paste_x, paste_y],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--restyled", required=True)
    ap.add_argument("--alpha", required=True, help="Blender 原始高分辨率帧目录（与 restyled 同结构）")
    ap.add_argument("--out", required=True)
    ap.add_argument("--height", type=int, default=HEIGHT_DEFAULT)
    ap.add_argument("--cell", default=CELL_DEFAULT)
    ap.add_argument("--anchor", default=ANCHOR_DEFAULT)
    ap.add_argument("--colors", type=int, default=32)
    ap.add_argument("--palette", default=None,
                    help="全局调色板 PNG（tools/palette.py 产出）；给了就用它，忽略 --colors 的逐帧量化")
    ap.add_argument("--ref", default=None, help="站姿参考帧，用来定死全角色统一缩放（强烈建议传 idle_00）")
    ap.add_argument("--threshold", type=int, default=128)
    ap.add_argument("--legacy-bbox", action="store_true", help="回到旧的逐帧 bbox 居中（仅用于 A/B 与回退）")
    args = ap.parse_args()

    cell = parse_cell(args.cell)
    anchor = tuple(int(v) for v in args.anchor.split(","))
    root, alpha_root, out_root = Path(args.restyled), Path(args.alpha), Path(args.out)
    files = sorted(p for p in root.rglob("*.png")
                   if not any(part.startswith(("_", ".")) for part in p.relative_to(root).parts))
    if not files:
        print(f"错误: {root} 没有 PNG", file=sys.stderr)
        return 2

    # 同一角色的所有帧共用一套裁剪/缩放参数
    alpha_files = []
    for f in files:
        apath = alpha_root / f.relative_to(root)
        if not apath.exists():
            print(f"错误: 缺少 alpha 源 {apath}", file=sys.stderr)
            return 2
        alpha_files.append(apath)

    ref_path = Path(args.ref) if args.ref else alpha_files[0]
    palette_img = None
    if args.palette:
        try:
            palette_img = Image.open(args.palette)
            if palette_img.mode != "P":
                palette_img = palette_img.convert("P", palette=Image.ADAPTIVE, colors=256)
        except Exception as e:  # noqa: BLE001
            print(f"错误: 读不到调色板 {args.palette}: {e}", file=sys.stderr)
            return 2
    try:
        plan = plan_box(alpha_files, ref_path, args.height, cell, args.threshold)
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        return 2
    print(json.dumps({"ref": str(ref_path), "box": plan["box"], "scale": round(plan["scale"], 4),
                      "rootX": plan["rootX"], "feetY": plan["feetY"]}, ensure_ascii=False))

    n = 0
    transforms = {}
    for f, apath in zip(files, alpha_files):
        try:
            img, info = compose(f, apath, cell, anchor, args.colors, args.threshold, plan,
                                args.legacy_bbox, palette_img)
        except ValueError as e:
            print(f"错误 {f}: {e}", file=sys.stderr)
            return 1
        dst = out_root / f.relative_to(root)
        dst.parent.mkdir(parents=True, exist_ok=True)
        img.save(dst)
        transforms[str(f.relative_to(root))] = info
        n += 1

    # 变换清单：供 pivot_drift.py 断言「后处理变换逐帧唯一」，也便于排查
    (out_root / "_compose.json").write_text(
        json.dumps({"cell": list(cell), "anchor": list(anchor), "plan": plan,
                    "legacy": args.legacy_bbox, "transforms": transforms},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(json.dumps({"restyled": str(root), "alpha": str(alpha_root), "out": str(out_root),
                      "colors": args.colors, "height": args.height, "count": n,
                      "mode": "legacy" if args.legacy_bbox else "fixed-box"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
