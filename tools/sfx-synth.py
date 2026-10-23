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


def sweep_sine_exp(dur: float, f_start: float, f_end: float, decay: float = 0.05,
                   attack: float = 0.0004, power: float = 1.6) -> np.ndarray:
    """指数扫频：撞击类音效的正确姿势（频率先陡后缓，听感比线性更像"砸下去"）。"""
    t = t_axis(dur)
    ratio = max(f_end / f_start, 1e-6)
    k = math.log(ratio) / dur
    phase = 2 * math.pi * f_start * (np.exp(k * t) - 1) / k
    return np.sin(phase) * env_ad(len(t), attack, decay, power)


def soft_clip(x: np.ndarray, drive: float = 1.8) -> np.ndarray:
    """tanh 软削波：压低波峰因数、抬高 RMS —— 同峰值下听感更"实"。"""
    return np.tanh(x * drive) / math.tanh(drive)


# ---------------------------------------------------------------- 人声（"呃啊"）
# 元音靠共振峰（formant）识别，不依赖任何采样：
#   /ə/（呃）F1≈500 F2≈1500 F3≈2500
#   /a/（啊）F1≈730 F2≈1090 F3≈2440
UH_FORMANTS = ((500, 90, 1.00), (1500, 120, 0.50), (2500, 180, 0.25))
AH_FORMANTS = ((730, 110, 1.00), (1090, 130, 0.60), (2440, 200, 0.30))


def glottal(dur: float, f0_start: float, f0_end: float, seed: int = 1,
            breath: float = 0.05) -> np.ndarray:
    """声门源：指数下滑的锯齿波 + 少量气声。"""
    t = t_axis(dur)
    ratio = max(f0_end / f0_start, 1e-6)
    k = math.log(ratio) / dur
    phase = 2 * math.pi * f0_start * (np.exp(k * t) - 1) / k
    saw = 2 * ((phase / (2 * math.pi)) % 1.0) - 1.0
    return saw + breath * noise(len(t), seed)


def formant_filter(src: np.ndarray, formants) -> np.ndarray:
    out = np.zeros_like(src)
    for fc, bw, gain in formants:
        out += gain * biquad(src, "bp", fc, q=max(0.4, fc / bw))
    return out


def voice(dur: float, f0a: float, f0b: float, formants, decay: float,
          seed: int, breath: float = 0.05, attack: float = 0.012,
          power: float = 1.3) -> np.ndarray:
    n = int(SR * dur)
    src = glottal(dur, f0a, f0b, seed, breath)
    return formant_filter(src, formants) * env_ad(n, attack, decay, power)


def sfx_hurt(seed=31):
    """玩家受击："呃"——短、偏高、收得快，和敌人死亡的"啊——"明确区分。"""
    dur = 0.20
    n = int(SR * dur)
    uh = voice(dur, 210, 132, UH_FORMANTS, decay=0.052, seed=seed, breath=0.07)
    breath = 0.25 * biquad(noise(n, seed + 1) * env_ad(n, 0.004, 0.030, 2.0), "bp", 1200, q=1.2)
    return soft_clip(uh + breath, 1.5)


def _unit(x: np.ndarray) -> np.ndarray:
    m = float(np.max(np.abs(x))) or 1.0
    return x / m


def sfx_enemy_die(seed=32):
    """敌人死亡："啊——" + 尾音断气滑向"呃" + 倒地闷响。

    注意：人声与闷响分别归一化再混合，否则闷响会盖过人声，
    起音时间会被误判成 260ms（实测过）。
    """
    dur = 0.42
    n = int(SR * dur)
    ah = _unit(voice(dur, 190, 76, AH_FORMANTS, decay=0.155, seed=seed, breath=0.08, power=1.1))
    uh = _unit(voice(0.18, 112, 68, UH_FORMANTS, decay=0.06, seed=seed + 2, breath=0.10))
    mix = ah.copy()
    tail = int(0.18 * SR)
    mix[-tail:] *= np.linspace(1.0, 0.35, tail)
    mix[-tail:] += 0.55 * uh[:tail]
    mix = _unit(mix)

    thud = np.zeros(n)
    start = int(0.26 * SR)
    seg = _unit(sweep_sine_exp(max(0.01, (n - start) / SR), 110, 42, decay=0.08,
                               attack=0.001, power=1.6))[: n - start]
    thud[start:start + len(seg)] = 0.35 * seg
    return soft_clip(0.95 * mix + thud, 1.3)


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


def write(x: np.ndarray, path: Path, fade_in_ms: float = 2.0) -> None:
    # 注意：淡入会削掉瞬态峰值。撞击类音效必须用 ~0.2ms，否则"最响的那一下"被磨圆
    pcm = np.clip(fade(normalize(x), fade_in_ms, 8), -1, 1)
    data = (pcm * 32767).astype("<i2").tobytes()
    import wave
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)


# ---------------------------------------------------------------- 各音效
def swept_noise(dur: float, centers, decay: float, attack: float = 0.002,
                seed: int = 1, q: float = 1.2, xfade_ms: float = 10.0) -> np.ndarray:
    """分段带通 + 交叉淡化 ≈ 滤波器扫频：噪声中心频率从高往低扫，就是"破空"。"""
    n = int(SR * dur)
    src = noise(n, seed)
    out = np.zeros(n)
    seg_n = max(1, n // len(centers))
    xf = max(1, int(SR * xfade_ms / 1000))
    for i, fc in enumerate(centers):
        a = max(0, i * seg_n - xf)
        b = min(n, (i + 1) * seg_n + xf)
        seg = biquad(src[a:b], "bp", fc, q=q)
        w = np.ones(b - a)
        ramp = min(2 * xf, len(w))
        if i > 0:
            w[:ramp] *= np.linspace(0, 1, ramp)
        if i < len(centers) - 1:
            w[-ramp:] *= np.linspace(1, 0, ramp)
        out[a:b] += seg * w
    return out * env_ad(n, attack, decay, 1.8)


def sfx_swing(seed=11):
    """挥空 = 破空声：高频噪声从 6.8k 扫到 2.4k + 起手一记"切" + 一点低频气流。

    旧版是三段互不重叠的带通拼接，段与段之间有跳变，听起来像"沙沙"而不是"咻"。
    """
    dur = 0.155
    n = int(SR * dur)
    air = swept_noise(dur, (5400, 3200, 1700), decay=0.052, attack=0.0018, seed=seed, q=1.0)
    cut = 0.34 * biquad(noise(n, seed + 2) * env_ad(n, 0.0005, 0.007, 3.0), "hp", 4200, q=0.7)
    whump = 0.55 * sweep_sine_exp(dur, 220, 90, decay=0.050, attack=0.001, power=1.5)
    body = 0.55 * sweep_sine_exp(dur, 620, 260, decay=0.038, attack=0.0012, power=1.8)
    return soft_clip(air + cut + whump + body, 1.3)


def sfx_hit(seed=12):
    """刀砍铁甲：低频冲击 + 宽带裂响 + 极短金属尖（软削波提密度）。

    旧版"没有击打感"的三个原因，逐条修掉：
      1. write() 的 2ms 淡入把瞬态峰值削平（实测 peak 只有 0.77）→ 现在 0.2ms
      2. 低频是 150→62Hz 线性扫频、75ms 衰减 → 改成 210→46Hz 指数扫频、45ms，并加二次谐波
      3. 金属余响 160ms 糊住瞬态 → 缩到 30ms；末端 tanh 软削波，波峰因数 8.0 → ~4.5
    """
    dur = 0.17
    n = int(SR * dur)
    sub = 0.72 * sweep_sine_exp(dur, 200, 52, decay=0.048, attack=0.0004, power=1.4)
    sub_h2 = 0.40 * sweep_sine_exp(dur, 400, 104, decay=0.030, attack=0.0004, power=1.9)
    # 中频"实心感"：380Hz 的短促 thock，是打击感里最常被忽略的一层
    thock = 0.30 * sweep_sine_exp(dur, 380, 300, decay=0.028, attack=0.0004, power=2.0)
    crack = biquad(noise(n, seed) * env_ad(n, 0.0004, 0.009, 2.8), "hp", 650, q=0.7)
    tick = np.zeros(n)
    for f0, amp in ((2600, 0.70), (3900, 0.55), (5600, 0.38), (7600, 0.20)):
        tick += amp * sweep_sine_exp(dur, f0, f0 * 0.96, decay=0.022, attack=0.0003, power=2.2)
    # 空气感：极短的高频"唰"，让命中在混音里"亮"出来
    air = biquad(noise(n, seed + 3) * env_ad(n, 0.0003, 0.006, 3.0), "hp", 4800, q=0.7)
    crunch = biquad(noise(n, seed + 7) * env_ad(n, 0.0008, 0.028, 2.0), "bp", 900, q=0.8)
    mix = 1.0 * sub + sub_h2 + thock + 1.55 * crack + 0.45 * crunch + tick + 0.55 * air
    # 驱动 1.7：仍然压得住波峰，但不像 1.9 那样把高频磨平
    return soft_clip(mix, 1.7)


def sfx_hit_heavy(seed=22):
    """重击/击杀：比普通命中更低更厚、尾巴略长，用来给连打制造节奏重音。"""
    dur = 0.22
    n = int(SR * dur)
    sub = 0.82 * sweep_sine_exp(dur, 240, 38, decay=0.055, attack=0.0004, power=1.4)
    sub_h2 = 0.34 * sweep_sine_exp(dur, 480, 76, decay=0.034, attack=0.0004, power=1.8)
    crack = biquad(noise(n, seed) * env_ad(n, 0.0004, 0.012, 2.6), "hp", 560, q=0.7)
    tick = np.zeros(n)
    for f0, amp in ((2100, 0.46), (3180, 0.36), (4620, 0.24), (6800, 0.14)):
        tick += amp * sweep_sine_exp(dur, f0, f0 * 0.94, decay=0.026, attack=0.0003, power=2.0)
    air = biquad(noise(n, seed + 4) * env_ad(n, 0.0003, 0.008, 3.0), "hp", 4400, q=0.7)
    crunch = biquad(noise(n, seed + 5) * env_ad(n, 0.001, 0.045, 1.8), "bp", 700, q=0.9)
    mix = 1.0 * sub + sub_h2 + 1.30 * crack + 0.60 * crunch + tick + 0.45 * air
    return soft_clip(mix, 1.9)


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


def sfx_jump(seed=17):
    """起跳：布料上扬 + 轻微上扫，比 dodge 更短更亮。"""
    dur = 0.14
    n = int(SR * dur)
    air = noise(n, seed) * env_ad(n, 0.008, 0.05, 2.0)
    out = biquad(air, "bp", 900, q=0.8) * 0.7
    out += 0.35 * sweep_sine(dur, 320, 620, 0.05)
    return 0.55 * out


def sfx_knife(seed=18):
    """飞刀命中：高频金属叮 + 极短裂响，和箭的木质闷响区分。"""
    dur = 0.18
    n = int(SR * dur)
    ting = np.zeros(n)
    for f, a, d in ((3100, 0.55, 0.05), (4700, 0.30, 0.03), (6900, 0.16, 0.02)):
        ting += a * np.sin(2 * np.pi * f * np.arange(n) / SR) * env_ad(n, 0.001, d, 3.0)
    crack = biquad(noise(n, seed) * env_ad(n, 0.001, 0.02, 3.5), "bp", 2400, q=0.9) * 0.45
    return soft_clip(0.6 * ting + crack, 1.4)


def sfx_pickup(seed=19):
    """拾取补给：两个上行音，短促、干净，一听就知道是"赚到"。"""
    dur = 0.2
    n = int(SR * dur)
    out = np.zeros(n)
    for i, (f, t0) in enumerate(((880, 0.0), (1320, 0.055))):
        start = int(SR * t0)
        seg = np.sin(2 * np.pi * f * np.arange(n - start) / SR)
        seg *= env_ad(n - start, 0.002, 0.05, 2.2)
        out[start:] += 0.5 * seg
    return out


GENERATORS = {
    # sfx_swing 暂时关闭：普攻打空现在要求静音（见 docs/ART_PIPELINE.md）。
    # 函数与配方仍保留，需要时把它加回这个字典即可。
    # "sfx_swing": sfx_swing,
    "sfx_hit": sfx_hit,
    "sfx_hit_heavy": sfx_hit_heavy,
    # sfx_hurt / sfx_enemy_die 现在由真人级 TTS 生成（百炼 CosyVoice / Qwen-TTS），
    # 后期在 tools/voice-fx.py。这里的 formant 合成版本只作为离线兜底，不再自动生成，
    # 否则重跑本脚本会覆盖掉 TTS 资产。
    "sfx_bow": sfx_bow,
    "sfx_dodge": sfx_dodge,
    "sfx_death": sfx_death,
    "sfx_special": sfx_special,
    "sfx_jump": sfx_jump,
    "sfx_knife": sfx_knife,
    "sfx_pickup": sfx_pickup,
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
        # 撞击类必须极短淡入，否则瞬态被削平（这就是旧版 hit 没"啪"感的主因）；
        # 人声留 0.6ms，太快会有咔哒声
        if name.startswith("sfx_hit"):
            fade_in = 0.2
        elif name in ("sfx_hurt", "sfx_enemy_die"):
            fade_in = 0.6
        else:
            fade_in = 2.0
        write(x, wav, fade_in_ms=fade_in)
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
