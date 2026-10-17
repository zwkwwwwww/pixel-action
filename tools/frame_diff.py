#!/usr/bin/env python3
"""帧间一致性闸门：逐剪辑比较相邻帧的像素差。

为什么需要：ComfyUI 逐帧重塑会引入「抖动」——同一角色相邻帧的材质/细节跳变，
在游戏里表现为闪烁。这里量化它，超过阈值就说明该剪辑要回退到 Blender 直出或调参重跑。

用法:
    python tools/frame_diff.py --in tmp/final --json-out art-source/reports/frame-diff.json [--threshold 0.22]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops


def diff_ratio(a: Image.Image, b: Image.Image) -> float:
    """两帧 RGBA 的归一化平均差（0~1）。透明区域按 0 处理，避免 alpha 抖动被误判。"""
    a = a.convert("RGBA")
    b = b.convert("RGBA")
    ca = Image.new("RGBA", a.size, (0, 0, 0, 0))
    cb = Image.new("RGBA", b.size, (0, 0, 0, 0))
    ca.alpha_composite(a)
    cb.alpha_composite(b)
    d = ImageChops.difference(ca.convert("RGB"), cb.convert("RGB")).convert("L")
    hist = d.histogram()
    total = sum(hist) or 1
    mean = sum(i * n for i, n in enumerate(hist)) / total
    return mean / 255.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--json-out", default=None)
    ap.add_argument("--threshold", type=float, default=0.22)
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    root = Path(args.inp)
    clips = sorted(d for d in root.iterdir() if d.is_dir())
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    report = {}
    bad = []
    for clip in clips:
        if only and clip.name not in only:
            continue
        files = sorted(clip.glob("*.png"))
        if len(files) < 2:
            report[clip.name] = {"frames": len(files), "max": 0.0, "mean": 0.0, "note": "帧数不足 2"}
            continue
        diffs = []
        for a, b in zip(files, files[1:]):
            diffs.append(diff_ratio(Image.open(a), Image.open(b)))
        mx = max(diffs)
        mean = sum(diffs) / len(diffs)
        report[clip.name] = {
            "frames": len(files),
            "max": round(mx, 4),
            "mean": round(mean, 4),
            "perPair": [round(d, 4) for d in diffs],
            "loopDiff": round(diff_ratio(Image.open(files[0]), Image.open(files[-1])), 4),
            "pass": mx <= args.threshold,
        }
        if mx > args.threshold:
            bad.append(clip.name)

    out = {"dir": str(root), "threshold": args.threshold, "clips": report, "failedClips": bad,
           "pass": len(bad) == 0}
    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk in ("frames", "max", "mean", "pass")} for k, v in report.items()},
                     ensure_ascii=False))
    if bad:
        print(f"帧间差超阈值: {bad}（阈值 {args.threshold}）", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
