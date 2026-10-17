#!/usr/bin/env python3
"""把逐帧 PNG 打包成精灵表 + JSON 元数据（契约见 docs/art-contract.md）。

用法:
    python tools/pack_sprites.py --in tmp/hero-px --out assets/sprites --name hero
    python tools/pack_sprites.py --in tmp/hero-px --out assets/sprites --name hero --cell 96x96
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image

# 与 docs/art-contract.md 第 3 节保持一致
CLIP_META = {
    "idle": {"fps": 8, "loop": True},
    "walk": {"fps": 12, "loop": True},
    "attack1": {"fps": 14, "loop": False},
    "attack2": {"fps": 14, "loop": False},
    "attack3": {"fps": 12, "loop": False},
    "dodge": {"fps": 16, "loop": False},
    "hurt": {"fps": 14, "loop": False},
    "death": {"fps": 10, "loop": False},
    "special": {"fps": 12, "loop": False},
}


def parse_size(s):
    w, h = s.lower().split("x")
    return int(w), int(h)


def frame_index(p: Path) -> int:
    m = re.search(r"_(\d+)\.png$", p.name)
    if not m:
        raise ValueError(f"文件名不含帧号: {p.name}")
    return int(m.group(1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--cell", default="96x96")
    ap.add_argument("--anchor", default="48,88")
    ap.add_argument("--clips", default=",".join(CLIP_META.keys()))
    ap.add_argument("--expect", default="", help="可选: idle=4,walk=6 强制校验帧数")
    args = ap.parse_args()

    inp = Path(args.inp)
    cell = parse_size(args.cell)
    anchor = tuple(int(v) for v in args.anchor.split(","))
    clips = [c.strip() for c in args.clips.split(",") if c.strip()]
    expect = {}
    if args.expect:
        for pair in args.expect.split(","):
            k, v = pair.split("=")
            expect[k.strip()] = int(v)

    rows = []
    meta = {"image": f"{args.name}.png", "cell": list(cell), "anchor": list(anchor), "clips": {}}

    for clip in clips:
        d = inp / clip
        if not d.is_dir():
            print(f"错误: 缺少剪辑目录 {d}", file=sys.stderr)
            return 2
        files = sorted(d.glob("*.png"), key=frame_index)
        if not files:
            print(f"错误: {d} 没有帧", file=sys.stderr)
            return 2
        idx = [frame_index(f) for f in files]
        if idx != list(range(len(files))):
            print(f"错误: {clip} 帧号不连续: {idx}", file=sys.stderr)
            return 2
        if clip in expect and len(files) != expect[clip]:
            print(f"错误: {clip} 期望 {expect[clip]} 帧，实际 {len(files)} 帧", file=sys.stderr)
            return 2
        rows.append((clip, files))

    max_cols = max(len(files) for _, files in rows)
    sheet_w, sheet_h = cell[0] * max_cols, cell[1] * len(rows)
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    for r, (clip, files) in enumerate(rows):
        frames = []
        for c, f in enumerate(files):
            im = Image.open(f).convert("RGBA")
            if im.size != cell:
                print(f"错误: {f} 尺寸 {im.size} != cell {cell}", file=sys.stderr)
                return 2
            sheet.alpha_composite(im, (c * cell[0], r * cell[1]))
            frames.append([c * cell[0], r * cell[1]])
        m = dict(CLIP_META.get(clip, {"fps": 10, "loop": False}))
        m["frames"] = frames
        meta["clips"][clip] = m

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sheet.save(out / f"{args.name}.png")
    (out / f"{args.name}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(json.dumps({
        "sheet": str(out / f"{args.name}.png"),
        "json": str(out / f"{args.name}.json"),
        "cell": list(cell), "cols": max_cols, "rows": len(rows),
        "clips": {c: len(f) for c, f in rows},
        "bytes": (out / f"{args.name}.png").stat().st_size,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
