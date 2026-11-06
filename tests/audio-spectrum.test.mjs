// 音效频谱契约：守住"打击音不能变成白噪音"这条线。
//
// 背景：上一版打击音把能量堆在 6~12kHz（质心 8034Hz、高频占 75%），
// 听感是"嘶啦"的静电噪音而不是"锵"的金属撞击 —— 人类反馈"难听"的根因。
// 这种退化肉眼看代码看不出来，必须用数字守住。
//
// 实现说明：不引第三方库，自带 4096 点 radix-2 FFT。
// （试过 Goertzel 离散频点：它对低频扫频信号严重低估，测出 346Hz 而实际 1826Hz，
//  不适合带扫频的游戏音效。）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = resolve(HERE, '..', 'assets', 'audio');
const FFT_N = 8192;   // 必须 >= 最长音效样本数，否则会截断尾巴导致质心偏低

/** 解析 16-bit 单声道 WAV。 */
function readWav(path) {
  const buf = readFileSync(path);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', `${path} 不是 RIFF`);
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE', `${path} 不是 WAVE`);

  let pos = 12;
  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = size;
      break;
    }
    pos = body + size + (size % 2);
  }
  assert.ok(fmt && dataOff >= 0, `${path} 缺 fmt/data 块`);
  assert.equal(fmt.bits, 16, `${path} 期望 16-bit`);
  assert.equal(fmt.channels, 1, `${path} 期望单声道`);

  const n = Math.floor(dataLen / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  }
  return { samples, rate: fmt.rate };
}

/** 原地 radix-2 FFT。 */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2];
        const bIm = im[i + k + len / 2];
        const vRe = bRe * curRe - bIm * curIm;
        const vIm = bRe * curIm + bIm * curRe;
        re[i + k] = aRe + vRe;
        im[i + k] = aIm + vIm;
        re[i + k + len / 2] = aRe - vRe;
        im[i + k + len / 2] = aIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function analyze(name) {
  const { samples, rate } = readWav(resolve(AUDIO, `${name}.wav`));

  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSq += samples[i] * samples[i];
  }

  // 补零到 FFT_N。**不加窗**：打击音的瞬态就在第 0 个样本，
  // Hann 窗在 i=0 处权重为 0，会把最关键的冲击抹掉（实测质心从 1826 掉到 451）。
  const re = new Float64Array(FFT_N);
  const im = new Float64Array(FFT_N);
  const n = Math.min(samples.length, FFT_N);
  for (let i = 0; i < n; i++) re[i] = samples[i];
  fft(re, im);

  const bins = FFT_N / 2;
  const df = rate / FFT_N;
  let magSum = 0;
  let wSum = 0;
  let highSum = 0;
  for (let k = 1; k < bins; k++) {
    const mag = Math.hypot(re[k], im[k]);
    const f = k * df;
    magSum += mag;
    wSum += mag * f;
    if (f > 2000) highSum += mag;
  }
  const centroid = magSum > 0 ? wSum / magSum : 0;
  const highPct = magSum > 0 ? (highSum / magSum) * 100 : 0;

  return {
    seconds: samples.length / rate,
    peak,
    rms: Math.sqrt(sumSq / samples.length),
    centroidHz: centroid,
    highPct,
  };
}

// 每个音效的期望区间：质心 [lo, hi]，2kHz 以上能量占比 [lo, hi]
const EXPECT = {
  sfx_hit: { c: [1200, 5200], h: [8, 65] },
  sfx_hit_heavy: { c: [800, 4200], h: [5, 60] },
  sfx_knife: { c: [1500, 5800], h: [10, 72] },
  sfx_bow: { c: [1000, 5000], h: [5, 62] },
  sfx_dodge: { c: [1500, 6200], h: [10, 72] },
  sfx_jump: { c: [1200, 5400], h: [8, 66] },
  sfx_hurt: { c: [400, 3200], h: [0, 35] },
  sfx_death: { c: [700, 4600], h: [3, 62] },
  sfx_special: { c: [900, 5200], h: [5, 68] },
  sfx_pickup: { c: [900, 4400], h: [5, 62] },
};

test('所有音效都不削波（peak < 0.95）', () => {
  for (const name of Object.keys(EXPECT)) {
    const m = analyze(name);
    assert.ok(m.peak < 0.95, `${name} peak ${m.peak.toFixed(3)} 过高，会削波失真`);
  }
});

test('所有音效时长都适合动作反馈', () => {
  for (const name of Object.keys(EXPECT)) {
    const m = analyze(name);
    assert.ok(m.seconds > 0.08 && m.seconds < 1.2,
      `${name} 时长 ${m.seconds.toFixed(2)}s 不合适（太长会糊住下一次按键）`);
  }
});

test('打击音是"实体感"而不是白噪音', () => {
  // 本次修复的核心断言：sfx_hit 曾经是 8034Hz / 高频 75%
  const m = analyze('sfx_hit');
  const e = EXPECT.sfx_hit;
  assert.ok(m.centroidHz >= e.c[0] && m.centroidHz <= e.c[1],
    `sfx_hit 质心 ${m.centroidHz.toFixed(0)}Hz 超出 [${e.c}]（太低闷、太高刺耳）`);
  assert.ok(m.highPct >= e.h[0] && m.highPct <= e.h[1],
    `sfx_hit 高频占比 ${m.highPct.toFixed(1)}% 超出 [${e.h}]`);
});

test('重击比普攻更低沉', () => {
  const light = analyze('sfx_hit');
  const heavy = analyze('sfx_hit_heavy');
  assert.ok(heavy.centroidHz < light.centroidHz,
    `重击质心 ${heavy.centroidHz.toFixed(0)} 应低于普攻 ${light.centroidHz.toFixed(0)}`);
});

test('拾取音有足够高频泛音（清脆铃音，不是电子哔声）', () => {
  const m = analyze('sfx_pickup');
  assert.ok(m.highPct >= 5,
    `sfx_pickup 高频占比仅 ${m.highPct.toFixed(1)}%，会像闷响/电子哔声`);
});

test('全部音效频谱落在各自期望区间', () => {
  const bad = [];
  for (const [name, e] of Object.entries(EXPECT)) {
    const m = analyze(name);
    if (m.centroidHz < e.c[0] || m.centroidHz > e.c[1]) {
      bad.push(`${name}: 质心 ${m.centroidHz.toFixed(0)}Hz 不在 [${e.c}]`);
    }
    if (m.highPct < e.h[0] || m.highPct > e.h[1]) {
      bad.push(`${name}: 高频 ${m.highPct.toFixed(1)}% 不在 [${e.h}]`);
    }
  }
  assert.deepEqual(bad, [], '频谱越界：\n' + bad.join('\n'));
});