#!/usr/bin/env python3
"""音效频谱体检：检查每个 SFX 的频谱质心与高频占比是否落在合理区间。

为什么需要这个工具：上一版打击音效把能量堆在 6~12kHz（质心 8034Hz、高频 75%），
听感是"嘶啦"的白噪音而不是"锵"的金属撞击 —— 这是人类反馈"难听"的根因。
肉眼看不出来，必须用数字守住。

合理区间（游戏音效经验值）：
    centroid 800 ~ 5500 Hz      低于 800 太闷(像水下)，高于 5500 刺耳(像静电)
    high%    3 ~ 65 %           2kHz 以上能量占比

用法: python tools/audio-spectrum.py [--json-out path] [--strict]
    --strict 时不合理会以退出码 1 结束（给 CI / 提交前检查用）
"""
from __future__ import annotations

import argparse
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

FFMPEG = Path(r"D:\Program Files (x86)\FormatFactory\ffmpeg.exe")

# 每个音效的期望区间：{name: (centroid_lo, centroid_hi, high_lo, high_hi)}
EXPECT = {
    # 打击：要"脆"但必须有实体感，不能是纯噪音
    "sfx_hit": (1500, 5500, 8, 65),
    "sfx_hit_heavy": (1000, 4500, 6, 60),
    # 飞刀：金属感更强，可以更亮
    "sfx_knife": (1500, 5000, 10, 65),
    # 弓箭：木质，中频
    "sfx_bow": (1200, 5000, 8, 60),
    # 位移：空气声，偏亮合理
    "sfx_dodge": (2000, 6000, 15, 70),
    "sfx_jump": (1500, 5500, 10, 65),
    # 人声：天生低频，不能要求高
    "sfx_hurt": (400, 3000, 0, 30),
    "sfx_death": (800, 4500, 5, 60),
    # 必杀：能量爆裂，中频为主
    "sfx_special": (1000, 5000, 8, 65),
    # 拾取：清脆的铃音，必须有高频泛音
    "sfx_pickup": (1200, 4500, 10, 60),
}


def load(path: Path) -> tuple[np.ndarray, int]:
    if path.suffix == ".wav":
        with wave.open(str(path), "rb") as w:
            sr = w.getframerate()
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
            return data.astype(np.float32) / 32768.0, sr
    proc = subprocess.run(
        [str(FFMPEG), "-v", "error", "-i", str(path),
         "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"],
        capture_output=True, check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32).copy(), 48000


def measure(path: Path) -> dict:
    x, sr = load(path)
    spec = np.abs(np.fft.rfft(x))
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    total = max(spec.sum(), 1e-9)
    centroid = float((spec * freqs).sum() / total)
    high = float(spec[freqs > 2000].sum() / total * 100)
    return {
        "seconds": round(len(x) / sr, 3),
        "peak": round(float(np.abs(x).max()), 3),
        "centroidHz": round(centroid, 1),
        "highPct": round(high, 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json-out", default="art-source/reports/audio-spectrum.json")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    audio = Path("assets/audio")
    report = {}
    bad = []

    for name, (c_lo, c_hi, h_lo, h_hi) in EXPECT.items():
        wav = audio / f"{name}.wav"
        if not wav.exists():
            report[name] = {"error": "missing"}
            bad.append(f"{name}: missing")
            continue
        m = measure(wav)
        problems = []
        if not (c_lo <= m["centroidHz"] <= c_hi):
            problems.append(f"centroid {m['centroidHz']:.0f} not in [{c_lo},{c_hi}]")
        if not (h_lo <= m["highPct"] <= h_hi):
            problems.append(f"high% {m['highPct']:.1f} not in [{h_lo},{h_hi}]")
        m["ok"] = not problems
        m["problems"] = problems
        report[name] = m
        if problems:
            bad.append(f"{name}: " + "; ".join(problems))

    print(json.dumps(report, ensure_ascii=False, indent=2))
    out = Path(args.json_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if bad:
        print("\nFAIL:")
        for b in bad:
            print("  " + b)
        return 1 if args.strict else 0
    print("\nall sfx within expected spectrum")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())