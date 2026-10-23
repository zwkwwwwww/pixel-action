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
    ap.add_argument("--fps-map", default="", help="可选: idle=16,walk=24 覆盖每剪辑播放帧率")
    ap.add_argument("--skip", default="",
                    help="可选: walk=10 或 walk=3|10（逗号分隔多个剪辑，竖线分隔帧号）—— 丢掉某些帧。"
                         "用于抑制「连续两帧双腿直立」造成的视觉暂留（直立姿势被保持两帧 = 125ms）")
    args = ap.parse_args()

    inp = Path(args.inp)
    cell = parse_size(args.cell)
    anchor = tuple(int(v) for v in args.anchor.split(","))
    clips = [c.strip() for c in args.clips.split(",") if c.strip()]
    fps_over = {}
    if args.fps_map:
        for pair in args.fps_map.split(","):
            k, v = pair.split("=")
            fps_over[k.strip()] = int(v)
    expect = {}
    if args.expect:
        for pair in args.expect.split(","):
            k, v = pair.split("=")
            expect[k.strip()] = int(v)
    skip = {}
    if args.skip:
        for pair in args.skip.split(","):
            k, v = pair.split("=")
            skip[k.strip()] = {int(x) for x in v.split("|") if x.strip()}

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
        # 连续性在「完整帧集」上校验完，再按 --skip 丢掉指定帧（不重排、不改名）
        if clip in skip:
            dropped = [files[i].name for i in sorted(skip[clip]) if 0 <= i < len(files)]
            files = [f for i, f in enumerate(files) if i not in skip[clip]]
            if not files:
                print(f"错误: {clip} 跳帧后没有剩余帧", file=sys.stderr)
                return 2
            print(f"[skip] {clip}: 丢掉 {dropped}，剩 {len(files)} 帧", file=sys.stderr)
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
        if clip in fps_over:
            m["fps"] = fps_over[clip]
        m["frames"] = frames
        meta["clips"][clip] = m

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sheet.save(out / f"{args.name}.png")
    # 内容版本号：让游戏加载 PNG 时带 ?v=<hash>，重建后浏览器不会继续用旧图
    import hashlib
    version = hashlib.sha256((out / f"{args.name}.png").read_bytes()).hexdigest()[:12]
    meta["version"] = version
    (out / f"{args.name}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(json.dumps({
        "sheet": str(out / f"{args.name}.png"),
        "json": str(out / f"{args.name}.json"),
        "version": version,
        "cell": list(cell), "cols": max_cols, "rows": len(rows),
        "clips": {c: len(f) for c, f in rows},
        "bytes": (out / f"{args.name}.png").stat().st_size,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
