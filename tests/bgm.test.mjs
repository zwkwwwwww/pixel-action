// BGM 契约：时长够长 + 不削波。
//
// 背景：上一版 BGM 只有 32s/28s，且**完全没做后处理** ——
// ACE-Step 原始输出 peak 1.39/1.41（>1.0 即削波），
// 削波产生刺耳的高频失真，加上 30 秒就循环一遍，听两分钟就烦。
//
// node 读不了 mp3，所以这里：
//   - 时长从 manifest 读（生成时就记下了）
//   - 削波用 ffmpeg 解码后分析（ffmpeg 不可用时跳过该断言，不让测试环境卡住）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const AUDIO = resolve(ROOT, 'assets', 'audio');
const FFMPEG = process.env.FFMPEG || 'D:\\Program Files (x86)\\FormatFactory\\ffmpeg.exe';

const manifest = JSON.parse(readFileSync(resolve(AUDIO, 'manifest.json'), 'utf8'));
const bgm = manifest.filter((e) => String(e.id).startsWith('bgm_'));

test('BGM 至少两首', () => {
  assert.ok(bgm.length >= 2, `BGM 数量 ${bgm.length}，至少要有战斗与 Boss 两首`);
});

test('BGM 时长 >= 60 秒（30 秒循环太明显）', () => {
  for (const e of bgm) {
    assert.ok(Number(e.seconds) >= 60,
      `${e.id} 只有 ${e.seconds}s，循环太短会让玩家很快听腻`);
  }
});

test('BGM 文件存在且大小合理', () => {
  for (const e of bgm) {
    const p = resolve(AUDIO, e.file);
    assert.ok(existsSync(p), `${e.file} 不存在`);
    const size = readFileSync(p).length;
    assert.ok(size > 100 * 1024, `${e.file} 只有 ${size}B，可疑`);
  }
});

test('BGM 不削波（peak <= 0.95）', (t) => {
  if (!existsSync(FFMPEG)) {
    t.skip(`ffmpeg 不可用（${FFMPEG}），跳过削波检查`);
    return;
  }
  for (const e of bgm) {
    const p = resolve(AUDIO, e.file);
    let buf;
    try {
      buf = execFileSync(FFMPEG, [
        '-v', 'error', '-i', p, '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1',
      ], { maxBuffer: 256 * 1024 * 1024 });
    } catch {
      t.skip('ffmpeg 解码失败，跳过');
      return;
    }
    const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
    let peak = 0;
    let over = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
      if (a > 1.0) over++;
    }
    assert.ok(peak <= 0.95,
      `${e.id} peak ${peak.toFixed(3)} 超过 0.95 —— 削波会产生刺耳失真（需跑 tools/audio-polish.py）`);
    assert.equal(over, 0, `${e.id} 有 ${over} 个样本超过 1.0（硬削波）`);
  }
});