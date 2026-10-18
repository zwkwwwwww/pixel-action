#!/usr/bin/env python3
"""游戏音效合成器：用 DSP 生成瞬态清晰的短音效。

为什么不再用 ACE-Step 生成短音效：它是音乐模型，1~2 秒的输出天然带音高、调性和混响尾巴，
当作「刀砍在铁甲上」听起来像一声短促的乐句。动作游戏需要的是：
  短（80~250ms）、干（无混响）、瞬态强（attack 时间 < 5ms）、频段明确。
这些用噪声整形 + 扫频 + 快速衰减包络就能做到，而且完全可复现、零生成耗时。

BGM 仍然用 ACE-Step（音乐是它的强项）。

用法:
    python tools/sfx-synth.py                # 生成到 assets/audio/
    python tools/sfx-synth.py --out tmp/sfx   # 试听版
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 44100
FFMPEG = Path(r"D:\Program Files (x86)\FormatFactory\ffmpeg.exe")


# ---------------------------------------------------------------- 基础工具
def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(SR * dur)) / SR


def env_ad(n: int, attack: float = 0.003, decay: float = 0.12, power: float = 2.2) -> np.ndarray:
    """快起慢落的包络：attack 内线性升到 1，之后指数衰减。"""
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-5), 0, 1)
    d = np.exp(-np.maximum(t - attack, 0) / max(decay, 1e-5)) ** power
    return a * d


def noise(n: int, seed: int = 1) -> np.ndarray:
    return np.random.default_rng(seed).normal(0, 1, n)


def biquad(x: np.ndarray, kind: str, f0: float, q: float = 0.9, gain_db: float = 0.0) -> np.ndarray:
    """RBJ Audio EQ Cookbook 双二阶滤波器（手写差分，不依赖 scipy）。"""
    w0 = 2 * math.pi * f0 / SR
    alpha = math.sin(w0) / (2 * q)
    cosw = math.cos(w0)
    if kind == "bp":
        b0, b1, b2 = alpha, 0.0, -alpha
    elif kind == "lp":
        b0, b1, b2 = (1 - cosw) / 2, 1 - cosw, (1 - cosw) / 2
    elif kind == "hp":
        b0, b1, b2 = (1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2
    else:
        raise ValueError(kind)
    a0, a1, a2 = 1 + alpha, -2 * cosw, 1 - alpha
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0

    y = np.empty_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, xv in enumerate(x):
        yv = b0 * xv + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        y[i] = yv
        x2, x1 = x1, xv
        y2, y1 = y1, yv
    if gain_db:
        y *= 10 ** (gain_db / 20)
    return y


def sweep_sine(dur: float, f_start: float, f_end: float, decay: float = 0.1) -> np.ndarray:
    t = t_axis(dur)
    f = np.linspace(f_start, f_end, len(t))
    phase = 2 * math.pi * np.cumsum(f) / SR
    return np.sin(phase) * env_ad(len(t), 0.002, decay, 1.6)


def normalize(x: np.ndarray, peak: float = 0.89) -> np.ndarray:
    m = float(np.max(np.abs(x))) or 1.0
    return x / m * peak


def fade(x: np.ndarray, ms_in: float = 2, ms_out: float = 8) -> np.ndarray:
    n_in, n_out = int(SR * ms_in / 1000), int(SR * ms_out / 1000)
    if n_in and len(x) > n_in:
        x[:n_in] *= np.linspace(0, 1, n_in)
    if n_out and len(x) > n_out:
        x[-n_out:] *= np.linspace(1, 0, n_out)
    return x


def write(x: np.ndarray, path: Path) -> None:
    pcm = np.clip(fade(normalize(x)), -1, 1)
    data = (pcm * 32767).astype("<i2").tobytes()
    import wave
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)


# ---------------------------------------------------------------- 各音效
def sfx_swing(seed=11):
    """刀剑挥空：高频噪声带通 + 快速衰减，尾巴留一点空气感。"""
    dur = 0.17
    n = int(SR * dur)
    x = noise(n, seed) * env_ad(n, 0.004, 0.055, 2.0)
    # 三段不同中心频率，模拟刀刃划过空气的「咻」
    seg = n // 3
    out = np.zeros(n)
    for i, f0 in enumerate((900, 1400, 2100)):
        s = slice(i * seg, (i + 1) * seg if i < 2 else n)
        out[s] = biquad(x[s], "bp", f0, q=1.4)
    out += 0.25 * sweep_sine(dur, 320, 180, 0.05)
    return out


def sfx_hit(seed=12):
    """刀砍铁甲：短促噪声撞击 + 低频实体感 + 金属余响。"""
    dur = 0.24
    n = int(SR * dur)
    click = noise(n, seed) * env_ad(n, 0.001, 0.014, 2.6)
    click = biquad(click, "bp", 2600, q=0.8)
    body = sweep_sine(dur, 150, 62, 0.075)
    ring = (0.30 * sweep_sine(dur, 1850, 1700, 0.16)
            + 0.20 * sweep_sine(dur, 2950, 2820, 0.12))
    crunch = biquad(noise(n, seed + 7) * env_ad(n, 0.002, 0.04, 2.0), "bp", 700, q=0.7)
    return 1.0 * click + 0.85 * body + ring + 0.45 * crunch


def sfx_bow(seed=13):
    """弓弦释放：紧绷的拨弦 + 短促摩擦噪声。"""
    dur = 0.22
    n = int(SR * dur)
    pluck = 0.8 * sweep_sine(dur, 300, 190, 0.075)
    overtone = 0.35 * sweep_sine(dur, 760, 520, 0.05)
    string = biquad(noise(n, seed) * env_ad(n, 0.001, 0.018, 3.0), "bp", 3200, q=0.9)
    return pluck + overtone + 0.5 * string


def sfx_dodge(seed=14):
    """翻滚闪避：低幅衣物摩擦，音量明显低于命中音。"""
    dur = 0.16
    n = int(SR * dur)
    x = noise(n, seed) * env_ad(n, 0.01, 0.06, 1.8)
    out = biquad(x, "bp", 520, q=0.7)
    out += 0.5 * biquad(x, "bp", 1100, q=1.0)
    return 0.7 * out


def sfx_death(seed=15):
    """敌人倒下：下坠音 + 盔甲落地。"""
    dur = 0.5
    n = int(SR * dur)
    fall = sweep_sine(dur, 210, 48, 0.2)
    clatter = biquad(noise(n, seed) * env_ad(n, 0.002, 0.06, 2.2), "bp", 1500, q=0.6) * 0.5
    thud = np.zeros(n)
    start = int(0.18 * SR)
    thud[start:] = sweep_sine(dur - start / SR, 90, 45, 0.12) * 0.7
    return 0.8 * fall + clatter + thud


def sfx_special(seed=16):
    """能量必杀：低频蓄力 + 上升噪声 + 一记清脆的能量爆裂。"""
    dur = 0.9
    n = int(SR * dur)
    t = t_axis(dur)
    # 蓄力：220→90Hz 的下降嗡鸣，前 0.25s
    charge = np.zeros(n)
    head = int(0.25 * SR)
    charge[:head] = sweep_sine(head / SR, 220, 90, 0.22) * 0.8
    # 爆发：上升噪声 + 高频 crack
    burst_env = env_ad(n - head, 0.001, 0.18, 2.4)
    burst = biquad(noise(n - head, seed) * burst_env, "bp", 1800, q=0.6)
    crack = biquad(noise(n - head, seed + 3) * env_ad(n - head, 0.0005, 0.02, 3.0), "hp", 3500, q=0.7)
    # 尾音：低频轰鸣
    boom = sweep_sine(dur - 0.12, 120, 55, 0.3) * 0.7
    out = charge.copy()
    out[head:] += 0.9 * burst + 0.7 * crack
    out[int(0.12 * SR):] += boom[: n - int(0.12 * SR)]
    return out


GENERATORS = {
    "sfx_swing": sfx_swing,
    "sfx_hit": sfx_hit,
    "sfx_bow": sfx_bow,
    "sfx_dodge": sfx_dodge,
    "sfx_death": sfx_death,
    "sfx_special": sfx_special,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="assets/audio")
    ap.add_argument("--keep-mp3", action="store_true", default=True,
                    help="同时用 ffmpeg 压一份 mp3（体积更小）")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    report = {}
    for name, gen in GENERATORS.items():
        x = gen()
        wav = out / f"{name}.wav"
        write(x, wav)
        dur = len(x) / SR
        peak = float(np.max(np.abs(x)))
        report[name] = {"seconds": round(dur, 3), "peak": round(peak, 3), "bytes": wav.stat().st_size}

        if args.keep_mp3 and FFMPEG.exists():
            mp3 = out / f"{name}.mp3"
            subprocess.run(
                [str(FFMPEG), "-y", "-loglevel", "error", "-i", str(wav),
                 "-codec:a", "libmp3lame", "-b:a", "192k", str(mp3)],
                check=False,
            )
            if mp3.exists():
                report[name]["mp3"] = str(mp3)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
