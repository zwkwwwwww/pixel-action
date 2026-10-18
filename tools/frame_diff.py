#!/usr/bin/env python3
"""帧间一致性闸门：逐剪辑比较相邻帧的差异。

为什么重写：旧实现在**整张 cell** 上取均值，而角色只占约 8%，把真实差异稀释 5–12 倍。
实测同一批素材：整 cell 均值 0.005–0.036，剪影内却是 0.045–0.23 ——
阈值 0.22 在旧口径下**数学上不可达**，所以历史上 5 份报告全 pass 不构成任何保证。

新口径：
- 只在**剪影交集**上求均值（去掉"运动边界"这种本帧本来就不同的像素，避免把动作幅度
  误判成闪烁）。整 cell 均值仍然输出，作为兼容字段。
- **循环剪辑**额外判定首尾帧（loopDiff）；旧实现算了但从不判定。
- 哪一项超标都会让脚本非零退出，构建脚本可以据此中断。

用法:
    python tools/frame_diff.py --in tmp/final-hero-v2 --json-out art-source/reports/frame-diff-hero.json \
        [--threshold 0.25] [--loop-threshold 0.20] [--loop-clips idle,walk]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops


def _premultiplied(im: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", im.size, (0, 0, 0, 0))
    canvas.alpha_composite(im.convert("RGBA"))
    return canvas.convert("RGB")


def _mask(im: Image.Image, threshold: int = 128) -> Image.Image:
    return im.convert("RGBA").getchannel("A").point(lambda v: 255 if v >= threshold else 0)


def diff_stats(a: Image.Image, b: Image.Image) -> dict:
    """返回 {cellMean, maskMean, maskPixels}；maskMean 只在剪影交集上统计。"""
    d = ImageChops.difference(_premultiplied(a), _premultiplied(b)).convert("L")

    hist = d.histogram()
    total = sum(hist) or 1
    cell_mean = sum(i * n for i, n in enumerate(hist)) / total / 255.0

    inter = ImageChops.multiply(_mask(a), _mask(b))
    dpx = d.tobytes()
    mpx = inter.tobytes()
    vals = [v for v, k in zip(dpx, mpx) if k]
    mask_mean = (sum(vals) / len(vals) / 255.0) if vals else 0.0
    return {"cellMean": cell_mean, "maskMean": mask_mean, "maskPixels": len(vals)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--json-out", default=None)
    ap.add_argument("--threshold", type=float, default=0.25, help="剪影交集上相邻帧均值的上限")
    ap.add_argument("--loop-threshold", type=float, default=0.20, help="循环剪辑首尾帧的上限")
    ap.add_argument("--loop-clips", default="idle,walk", help="哪些剪辑是循环的（逗号分隔）")
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    root = Path(args.inp)
    if not root.is_dir():
        print(f"错误: {root} 不是目录", file=sys.stderr)
        return 2
    clips = sorted(d for d in root.iterdir() if d.is_dir())
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    looping = {s.strip() for s in args.loop_clips.split(",") if s.strip()}
    report = {}
    bad = []
    for clip in clips:
        if only and clip.name not in only:
            continue
        files = sorted(clip.glob("*.png"))
        if len(files) < 2:
            report[clip.name] = {"frames": len(files), "note": "帧数不足 2", "pass": True}
            continue
        stats = [diff_stats(Image.open(a), Image.open(b)) for a, b in zip(files, files[1:])]
        mask_max = max(s["maskMean"] for s in stats)
        mask_mean = sum(s["maskMean"] for s in stats) / len(stats)
        loop = diff_stats(Image.open(files[0]), Image.open(files[-1]))
        entry = {
            "frames": len(files),
            "cellMax": round(max(s["cellMean"] for s in stats), 4),
            "maskMax": round(mask_max, 4),
            "maskMean": round(mask_mean, 4),
            "perPairMask": [round(s["maskMean"], 4) for s in stats],
            "loopDiff": round(loop["maskMean"], 4),
        }
        entry["pass"] = mask_max <= args.threshold
        if clip.name in looping:
            entry["loopPass"] = loop["maskMean"] <= args.loop_threshold
            entry["pass"] = entry["pass"] and entry["loopPass"]
        if not entry["pass"]:
            bad.append(f"{clip.name}:{entry['maskMax']}" + ("" if entry.get("loopPass", True) else f"/loop:{entry['loopDiff']}"))
        report[clip.name] = entry

    out = {"dir": str(root), "threshold": args.threshold, "loopThreshold": args.loop_threshold,
           "loopClips": sorted(looping), "clips": report, "failedClips": bad, "pass": not bad}
    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({k: {kk: v.get(kk) for kk in ("maskMax", "maskMean", "loopDiff", "cellMax", "pass")}
                      for k, v in report.items()}, ensure_ascii=False))
    if bad:
        print(f"帧间差超阈值: {bad}（剪影阈值 {args.threshold}，循环阈值 {args.loop_threshold}）",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
