#!/usr/bin/env python3
"""音频后处理：BGM 响度归一化 + 硬限幅。

为什么必须有这一步：ACE-Step 的原始输出 peak 可达 1.4（>1.0 即削波），
削波产生的是**刺耳的高频失真** —— 这是"音乐难听"最直接的技术原因。
生成式音频不能直接进游戏，必须归一化 + 限幅。

为什么不用 ffmpeg 滤镜链：loudnorm 的两遍测量在 mp3 上会因解码 overshoot
反复失准（实测报 "0.00 dBFS" 且处理后仍有 1.06 的峰）。这里直接解码成
float32 样本，在 numpy 里做精确的归一化与软限幅，完全可控。

用法:
    python tools/audio-polish.py              # 处理全部
    python tools/audio-polish.py --only bgm_battle
    python tools/audio-polish.py --dry        # 只报告指标
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

FFMPEG = Path(r"D:\Program Files (x86)\FormatFactory\ffmpeg.exe")
SR_OUT = 48000

# 目标：BGM 峰值压到 -1dBFS，同时整体响度不至于太小。
# BGM 是背景，要让位给音效，所以峰值目标比音效更低一点。
TARGETS = {
    "bgm_battle": {"peak": 0.84, "rms_min": 0.10},
    "bgm_boss": {"peak": 0.86, "rms_min": 0.11},
}


def decode(path: Path) -> np.ndarray:
    """解码成单声道 float32（0dBFS = 1.0）。"""
    proc = subprocess.run(
        [str(FFMPEG), "-v", "error", "-i", str(path),
         "-f", "f32le", "-ac", "1", "-ar", str(SR_OUT), "pipe:1"],
        capture_output=True, check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def stats(x: np.ndarray) -> dict:
    peak = float(np.abs(x).max()) if len(x) else 0.0
    rms = float(np.sqrt((x ** 2).mean())) if len(x) else 0.0
    over = float((np.abs(x) > 1.0).mean() * 100) if len(x) else 0.0
    return {"peak": peak, "rms": rms, "overPct": over, "seconds": len(x) / SR_OUT}


def limit(x: np.ndarray, peak_target: float) -> np.ndarray:
    """两步：先整体缩放到目标峰值，再对残余尖峰做 tanh 软限幅。

    只在极少数样本上做软削波，不会伤到整体动态（BGM 不该听起来像被压扁）。
    """
    src = stats(x)
    if src["peak"] <= 1e-9:
        return x
    x = x * (peak_target / src["peak"])
    # 软限幅：超过 0.92 的部分用 tanh 压回来，避免个别尖峰再次超限
    knee = 0.92 * peak_target / peak_target  # = 0.92
    over = np.abs(x) > knee
    if over.any():
        s = np.sign(x[over])
        excess = (np.abs(x[over]) - knee) / max(1e-6, (1.0 - knee))
        x[over] = s * (knee + (1.0 - knee) * np.tanh(excess))
    # 兜底：再检查一次
    p2 = float(np.abs(x).max())
    if p2 > peak_target:
        x *= peak_target / p2
    return x


def encode(x: np.ndarray, path: Path) -> None:
    """写回 mp3（192k，与现有一致）。"""
    tmp_wav = path.with_suffix(".tmp.wav")
    import wave
    pcm = np.clip(x, -1.0, 1.0)
    pcm16 = (pcm * 32767).astype(np.int16)
    with wave.open(str(tmp_wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR_OUT)
        w.writeframes(pcm16.tobytes())
    subprocess.run(
        [str(FFMPEG), "-y", "-hide_banner", "-loglevel", "error",
         "-i", str(tmp_wav), "-codec:a", "libmp3lame", "-b:a", "192k", str(path)],
        check=True,
    )
    tmp_wav.unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None)
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    only = set(args.only.split(",")) if args.only else None
    audio = Path("assets/audio")
    backup = Path("art-source/audio-raw")
    backup.mkdir(parents=True, exist_ok=True)

    report = {}
    for name, cfg in TARGETS.items():
        if only and name not in only:
            continue
        src = audio / f"{name}.mp3"
        if not src.exists():
            print(f"skip {name} (missing)")
            continue
        raw = backup / f"{name}.mp3"
        # 备份只在第一次做：保证反复调参时始终从原始生成结果出发
        if not raw.exists():
            raw.write_bytes(src.read_bytes())

        x = decode(raw)
        before = stats(x)
        if args.dry:
            report[name] = {"before": before}
            print(f"{name}: peak {before['peak']:.3f} rms {before['rms']:.3f} "
                  f"over1.0 {before['overPct']:.3f}% {before['seconds']:.1f}s")
            continue

        y = limit(x, cfg["peak"])
        after = stats(y)
        encode(y, src)
        # 编解码后复测（mp3 会引入少量 overshoot，必须验证最终文件）
        final = stats(decode(src))
        report[name] = {"before": before, "after": after, "final": final}
        print(f"{name}: {before['peak']:.3f} -> {final['peak']:.3f} "
              f"({final['seconds']:.0f}s, over1.0 {final['overPct']:.3f}%) "
              f"{'OK' if final['peak'] <= cfg['peak'] + 0.02 else 'CHECK'}")

    if args.dry:
        return 0
    out = Path("art-source/reports/audio-polish.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())