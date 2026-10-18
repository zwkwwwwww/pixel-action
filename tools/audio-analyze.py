#!/usr/bin/env python3
"""音效体检：对比「ACE-Step 生成」与「DSP 合成」两组短音效的客观指标。

关注三个决定「打击感」的量：
  - duration   时长（动作音效应该短，长了会糊住下一次按键）
  - attack_ms  起音时间（从首次超过 5% 峰值到峰值；越小越「脆」）
  - centroid   频谱质心（越高越亮、越像金属/空气；越低越闷）

用法: python tools/audio-analyze.py [--json-out art-source/reports/audio-compare.json]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

FFMPEG = Path(r"D:\Program Files (x86)\FormatFactory\ffmpeg.exe")
SR = None


def load_audio(path: Path) -> np.ndarray:
    global SR
    if path.suffix == ".wav":
        with wave.open(str(path), "rb") as w:
            SR = w.getframerate()
            data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
            if w.getnchannels() > 1:
                data = data.reshape(-1, w.getnchannels()).mean(axis=1)
            return data
    # mp3 → wav（临时）
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "x.wav"
        subprocess.run([str(FFMPEG), "-y", "-loglevel", "error", "-i", str(path), str(out)], check=True)
        if not out.exists():
            raise RuntimeError(f"ffmpeg 转码失败: {path}")
        return load_audio(out)


def measure(x: np.ndarray, sr: int) -> dict:
    x = x - np.mean(x)
    peak = float(np.max(np.abs(x))) or 1e-9
    # 起音时间
    thresh = 0.05 * peak
    idx = np.argmax(np.abs(x) >= thresh)
    peak_idx = int(np.argmax(np.abs(x)))
    attack_ms = round((peak_idx - idx) / sr * 1000, 2)
    # 频谱质心
    win = np.hanning(len(x))
    spec = np.abs(np.fft.rfft(x * win)) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    centroid = float(np.sum(freqs * spec) / (np.sum(spec) + 1e-12))
    high_ratio = float(np.sum(spec[freqs > 4000]) / (np.sum(spec) + 1e-12))
    return {
        "seconds": round(len(x) / sr, 3),
        "attackMs": attack_ms,
        "centroidHz": round(centroid, 1),
        "highRatio": round(high_ratio, 3),
        "rms": round(float(np.sqrt(np.mean(x ** 2))), 4),
        "peak": round(peak, 3),
    }


TARGETS = ["sfx_swing", "sfx_hit", "sfx_dodge", "sfx_death", "sfx_special"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-dir", default="art-source/audio")
    ap.add_argument("--new-dir", default="assets/audio")
    ap.add_argument("--json-out", default="art-source/reports/audio-compare.json")
    args = ap.parse_args()

    rows = {}
    for tid in TARGETS:
        row = {}
        old = Path(args.old_dir) / f"{tid}.mp3"
        new_wav = Path(args.new_dir) / f"{tid}.wav"
        new_mp3 = Path(args.new_dir) / f"{tid}.mp3"
        if old.exists():
            a = load_audio(old)
            row["ace"] = measure(a, SR)
        if new_wav.exists():
            b = load_audio(new_wav)
            row["synth"] = measure(b, SR)
        elif new_mp3.exists():
            b = load_audio(new_mp3)
            row["synth"] = measure(b, SR)
        rows[tid] = row

    path = Path(args.json_out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
