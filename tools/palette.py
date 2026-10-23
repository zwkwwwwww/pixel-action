#!/usr/bin/env python3
"""固化全局受限调色板（art-contract.md 第 1 节要求 ≤48 色，本工具是它承诺的
`tools/palette.py`）。

为什么需要：compose_final 早期对**每一帧独立** median-cut，导致
hero 一张精灵表 1237 色、5 张表并集 3927 色、**只有 4 色共有**（两两 Jaccard 0.012–0.031）。
后果是换装/白闪/Boss 狂暴变色在技术上做不了，同屏不同角色的"锈红"是 5 种红。

做法：把所有角色的成品帧采样成像素池，做一次 median-cut 得到全局表，
写成 P 模式 PNG（`quantize(palette=...)` 可直接吃）与同名 JSON（人可读 + 可 diff）。

用法:
    python tools/palette.py --in tmp/final-hero tmp/final-enemies --out art-source/palette.png --colors 48
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

MAX_SAMPLES = 2_000_000
ROW_WIDTH = 1024


def collect(dirs: list[Path], step: int) -> tuple[np.ndarray, list[str]]:
    chunks: list[np.ndarray] = []
    used: list[str] = []
    total = 0
    for d in dirs:
        files = sorted(p for p in d.rglob("*.png")
                       if not any(part.startswith((".", "_")) for part in p.relative_to(d).parts))
        if not files:
            continue
        used.append(str(d))
        for f in files[::step]:
            im = Image.open(f).convert("RGBA")
            arr = np.asarray(im, dtype=np.uint8).reshape(-1, 4)
            opaque = arr[arr[:, 3] >= 128][:, :3]
            if not len(opaque):
                continue
            chunks.append(opaque)
            total += len(opaque)
            if total >= MAX_SAMPLES:
                break
        if total >= MAX_SAMPLES:
            break
    if not chunks:
        raise ValueError("没有采到任何不透明像素")
    return np.concatenate(chunks, axis=0), used


def build_palette(pixels: np.ndarray, colors: int) -> Image.Image:
    """把像素池摊成一张长图，用 PIL 的 median-cut 得到 ≤colors 的表。"""
    n = len(pixels)
    rows = (n + ROW_WIDTH - 1) // ROW_WIDTH
    padded = np.zeros((rows * ROW_WIDTH, 3), dtype=np.uint8)
    padded[:n] = pixels
    canvas = Image.fromarray(padded.reshape(rows, ROW_WIDTH, 3), mode="RGB")
    return canvas.quantize(colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inputs", nargs="+", required=True, help="成品帧目录（可有多个）")
    ap.add_argument("--out", required=True, help="输出 P 模式 PNG（如 art-source/palette.png）")
    ap.add_argument("--colors", type=int, default=48)
    ap.add_argument("--step", type=int, default=1, help="每隔 N 帧采样一次（默认全采）")
    args = ap.parse_args()

    dirs = [Path(p) for p in args.inputs]
    for d in dirs:
        if not d.is_dir():
            print(f"错误: {d} 不是目录", file=sys.stderr)
            return 2
    try:
        pixels, used = collect(dirs, max(1, args.step))
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        return 2

    pal = build_palette(pixels, args.colors)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    pal.save(out)

    palette = pal.getpalette()[: args.colors * 3]
    rgb = [tuple(palette[i:i + 3]) for i in range(0, len(palette), 3)]
    meta = {
        "file": out.name,
        "colors": len(rgb),
        "sources": used,
        "samples": int(len(pixels)),
        "rgb": rgb,
    }
    out.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"out": str(out), "colors": len(rgb), "samples": int(len(pixels)),
                      "sources": len(used)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
