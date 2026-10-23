#!/usr/bin/env python3
"""Walk 剪辑的"别站直"闸门。

背景：walk 是原地动画，靠腿部开合表达步态。如果**相邻两帧都接近双腿直立**，
这个姿势会被保持两帧（16fps 下 125ms），人眼会把"站直"暂留下来，看起来像
有一个静止站立的不透明图层叠在运动角色上（实测 hero 的 09/10、grunt/ranger 的 02/03 与 09/10）。

判据：取每帧 alpha 包围盒下部 18% 的横向跨度（≈两脚间距），
若存在连续两帧都 < `--min-spread`（默认为该角色最大跨度的 45%），判定失败。

用法:
    python tools/walk_gate.py --sheet assets/sprites/hero.json [--clip walk] [--min-spread 16]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def leg_spread(cell: Image.Image) -> int:
    a = np.asarray(cell.convert("RGBA"))[..., 3] >= 128
    ys, xs = np.where(a)
    if not len(xs):
        return 0
    y1, y0 = int(ys.max()), int(ys.min())
    band = a[int(y1 - (y1 - y0) * 0.18): y1 + 1]
    by, bx = np.where(band)
    return int(bx.max() - bx.min()) if len(bx) else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", required=True, help="assets/sprites/<name>.json")
    ap.add_argument("--clip", default="walk")
    ap.add_argument("--min-spread", type=int, default=0,
                    help="0 = 自动取最大跨度的 30%（实测 45% 太严，会把正常过渡步也判成直立）")
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args()

    jp = Path(args.sheet)
    meta = json.loads(jp.read_text(encoding="utf-8"))
    png = jp.with_suffix(".png")
    if args.clip not in meta["clips"]:
        print(f"跳过: {jp.name} 没有 {args.clip} 剪辑")
        return 0
    clip = meta["clips"][args.clip]
    cw, ch = meta["cell"]
    sheet = Image.open(png).convert("RGBA")

    spreads = []
    for (x, y) in clip["frames"]:
        spreads.append(leg_spread(sheet.crop((x, y, x + cw, y + ch))))

    threshold = args.min_spread or max(1, int(max(spreads) * 0.30))
    pairs = [i for i in range(len(spreads) - 1)
             if spreads[i] < threshold and spreads[i + 1] < threshold]

    out = {
        "sheet": str(jp), "clip": args.clip, "frames": len(spreads),
        "spreads": spreads, "threshold": threshold,
        "consecutiveStraightPairs": pairs, "pass": not pairs,
    }
    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({k: out[k] for k in ("clip", "frames", "threshold", "consecutiveStraightPairs", "pass")},
                     ensure_ascii=False))
    if pairs:
        print(f"walk 连续直立帧: 帧对 {pairs}（阈值 {threshold}px）→ 会把站姿暂留成残影",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
