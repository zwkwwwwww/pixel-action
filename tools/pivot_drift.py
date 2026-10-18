#!/usr/bin/env python3
"""Pivot / 后处理刚性闸门。

背景：compose_final.py 早期把「每帧可见内容的中心」钉在锚点，任何非对称伸展（挥剑、倒地）
都会把身体推离锚点：hero attack2 实测腿轴漂移 17.5px，而碰撞盒用的是固定锚点 →
可见身体与判定框错位。

**闸门是「变换逐帧唯一」**：从 compose_final 产出的 `_compose.json` 读每帧实际使用的
(box, scale, paste)，同一剪辑内必须全部相同。这才是"后处理没有额外平移"的精确判据。

为什么不用「从 alpha bbox 反推位移」：bbox 的顶部/宽度会随**内容**变化（刀刃伸出、倒地），
不同帧的 bbox 本来就不该有相同尺寸，反推出来的位移是动画，不是后处理误差
（实测误导：attack1 会报 5px，实际变换完全一致）。

`legAxisSpreadPx` 只作参考输出（下半身 alpha 质心横向极差）：倒地/闪避本来就会移动身体。

用法:
    python tools/pivot_drift.py --in tmp/final-hero-v2 [--compose-json tmp/final-hero-v2/_compose.json]
    python tools/pivot_drift.py --in tmp/final-hero --source art-source/blender/hero   # 无清单时只看参考值
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

LOWER_BODY_FRACTION = 0.45


def leg_axis_centroid(path: Path, threshold: int = 128) -> float | None:
    """下半身 alpha 加权横向质心（cell 内像素坐标）。仅作参考指标。"""
    a = Image.open(path).convert("RGBA").getchannel("A").point(lambda v: 255 if v >= threshold else 0)
    bb = a.getbbox()
    if not bb:
        return None
    x0, y0, x1, y1 = bb
    h = y1 - y0
    top = y1 - max(1, int(round(h * LOWER_BODY_FRACTION)))
    region = a.crop((x0, top, x1, y1))
    w, hh = region.size
    px = region.load()
    num = den = 0.0
    for y in range(hh):
        for x in range(w):
            v = px[x, y]
            if v:
                num += (x + x0) * v
                den += v
    return num / den if den else None


def key_of(info: dict) -> str:
    return json.dumps([info.get("box"), info.get("scale"), info.get("paste")], sort_keys=True)


def measure(root: Path, compose_json: Path | None, threshold: int) -> dict:
    transforms = {}
    if compose_json and compose_json.exists():
        data = json.loads(compose_json.read_text(encoding="utf-8"))
        transforms = data.get("transforms", {})

    clips = sorted(d for d in root.iterdir() if d.is_dir())
    report = {}
    bad = []
    for clip in clips:
        files = sorted(clip.glob("*.png"))
        entry = {"frames": len(files)}

        # 闸门：同一剪辑内变换必须唯一
        infos = [transforms[str(f.relative_to(root))] for f in files
                 if str(f.relative_to(root)) in transforms]
        if len(infos) >= 2:
            uniq = {key_of(i) for i in infos}
            entry["uniqueTransforms"] = len(uniq)
            entry["pass"] = len(uniq) == 1
            if not entry["pass"]:
                bad.append(f"{clip.name}:{len(uniq)}种变换")
        elif compose_json:
            entry["note"] = "缺变换清单"
            entry["pass"] = False
            bad.append(f"{clip.name}:缺清单")
        else:
            entry["note"] = "无 transform 清单，仅参考值"
            entry["pass"] = None

        legs = [v for v in (leg_axis_centroid(f, threshold) for f in files) if v is not None]
        entry["legAxisSpreadPx"] = round(max(legs) - min(legs), 2) if len(legs) >= 2 else 0.0
        report[clip.name] = entry

    return {"dir": str(root), "composeJson": str(compose_json) if compose_json else None,
            "clips": report, "failedClips": bad,
            "pass": (not bad) if compose_json else None}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--compose-json", default=None, help="compose_final 产出的 _compose.json；给了才判定")
    ap.add_argument("--alpha-threshold", type=int, default=128)
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args()

    root = Path(args.inp)
    if not root.is_dir():
        print(f"错误: {root} 不是目录", file=sys.stderr)
        return 2
    cj = Path(args.compose_json) if args.compose_json else (root / "_compose.json")
    out = measure(root, cj if cj.exists() else None, args.alpha_threshold)
    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({k: {"transforms": v.get("uniqueTransforms"), "legs": v.get("legAxisSpreadPx"),
                          "pass": v.get("pass")} for k, v in out["clips"].items()}, ensure_ascii=False))
    if out["failedClips"]:
        print(f"后处理变换不唯一: {out['failedClips']}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
