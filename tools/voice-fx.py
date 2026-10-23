#!/usr/bin/env python3
"""把人声 TTS 产物做成游戏用音效。

来源：百炼 CosyVoice v3 / Qwen-Audio-TTS（见 docs/ART_PIPELINE.md「人声」一节）。
TTS 原始输出带长静音、电平偏小，且死亡缺少"倒地"的重量感，所以这里统一做后期：

  - 裁掉首尾静音（阈值取峰值的 3%），保留 8ms 余量
  - 截到目标时长（受击 280ms / 死亡 660ms）
  - 死亡音在 0.38s 处叠一记低频闷响（身体落地），再做 tanh 软削波
  - 归一化到 0.89 峰值，1ms 淡入 / 20~80ms 淡出

用法:
    python tools/voice-fx.py --hurt tmp/voice/hurt2.wav --die tmp/voice/die2.wav
"""
from __future__ import annotations

import argparse
import math
import wave
from pathlib import Path

import numpy as np

SR = 44100


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        n, ch, sr = w.getnframes(), w.getnchannels(), w.getframerate()
        x = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if sr != SR:
        idx = np.linspace(0, len(x) - 1, int(len(x) * SR / sr))
        x = np.interp(idx, np.arange(len(x)), x).astype(np.float32)
    return x


def write_wav(x: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(x, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((pcm * 32767).astype("<i2").tobytes())


def trim(x: np.ndarray, max_seconds: float, pad_ms: float = 8.0) -> np.ndarray:
    env = np.abs(x)
    thr = max(1e-4, env.max() * 0.03)
    idx = np.where(env > thr)[0]
    if not len(idx):
        return x
    pad = int(SR * pad_ms / 1000)
    a = max(0, idx[0] - pad)
    b = min(len(x), idx[-1] + pad)
    seg = x[a:b]
    cap = int(SR * max_seconds)
    return seg[:cap]


def fade(x: np.ndarray, ms_in: float, ms_out: float) -> np.ndarray:
    n_in, n_out = int(SR * ms_in / 1000), int(SR * ms_out / 1000)
    y = x.copy()
    if n_in and len(y) > n_in:
        y[:n_in] *= np.linspace(0, 1, n_in)
    if n_out and len(y) > n_out:
        y[-n_out:] *= np.linspace(1, 0, n_out)
    return y


def normalize(x: np.ndarray, peak: float = 0.89) -> np.ndarray:
    m = float(np.max(np.abs(x))) or 1.0
    return x / m * peak


def thud(dur: float, f0=110.0, f1=42.0) -> np.ndarray:
    """低频闷响：指数下滑 + 快速衰减（身体落地）。"""
    n = int(SR * dur)
    t = np.arange(n) / SR
    k = math.log(f1 / f0) / dur
    phase = 2 * math.pi * f0 * (np.exp(k * t) - 1) / k
    env = np.exp(-t / 0.06)
    return np.sin(phase) * env


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hurt", required=True, help="玩家受击 TTS 原始 wav")
    ap.add_argument("--die", default=None,
                    help="（可选）敌人死亡 TTS 原始 wav。当前版本游戏里已去掉死亡人声，"
                         "只留下击杀时的撞击音，所以默认不生成；需要时再传这个参数")
    ap.add_argument("--out-dir", default="assets/audio")
    args = ap.parse_args()

    out = Path(args.out_dir)
    results = []

    # 受击：TTS 的起音有 50ms 渐强，游戏里会"软"。在 t=0 补一记低频冲击，
    # 瞬态交给冲击层、痛感交给人声 —— 这是动作游戏的常规做法。
    hurt_voice = normalize(fade(trim(read_wav(Path(args.hurt)), 0.28), 1.0, 20), 0.95)
    impact = thud(0.11, 150.0, 44.0)
    hurt = hurt_voice.copy()
    n = min(len(hurt), len(impact))
    hurt[:n] += 0.55 * impact[:n]
    hurt = normalize(np.tanh(hurt * 1.15) / math.tanh(1.15), 0.80)
    write_wav(hurt, out / "sfx_hurt.wav")
    results.append(("sfx_hurt", hurt))

    if args.die:
        die_voice = fade(trim(read_wav(Path(args.die)), 0.66), 1.5, 90)
        die_voice = normalize(die_voice, 0.92)
        t = thud(0.20)
        start = int(0.38 * SR)
        mix = die_voice.copy()
        end = min(len(mix), start + len(t))
        mix[start:end] += 0.12 * t[: end - start]
        die = normalize(np.tanh(mix * 1.25) / math.tanh(1.25))
        write_wav(die, out / "sfx_enemy_die.wav")
        results.append(("sfx_enemy_die", die))

    for name, x in results:
        print(f"{name}: {len(x)/SR*1000:.0f}ms peak={np.max(np.abs(x)):.2f} "
              f"rms={np.sqrt((x**2).mean()):.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
