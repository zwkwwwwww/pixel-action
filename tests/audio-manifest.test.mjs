// 音频清单契约：**游戏用到的每个音频 id 都必须在 manifest 里登记**。
//
// 为什么必须有这条：tools/comfy/audio-batch.mjs 曾经直接覆盖 manifest.json，
// 只写入它自己生成的 BGM 条目 —— 结果 13 个音频只剩 2 个被加载，
// playSfx 里 `if (!buf) return` 静默返回，玩家听到的是"完全没有攻击音效"。
// 音频文件明明都在磁盘上，代码也没坏，只是清单漏了。这类问题必须用测试守住。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const AUDIO = resolve(ROOT, 'assets', 'audio');

const manifest = JSON.parse(readFileSync(resolve(AUDIO, 'manifest.json'), 'utf8'));
const byId = new Map(manifest.map((e) => [e.id, e]));

/** 从源码里抓出所有 playSfx('x') / playBgm('x') 的字面量 id。 */
function collectUsedIds(relPath) {
  const src = readFileSync(resolve(ROOT, relPath), 'utf8');
  const ids = new Set();
  for (const m of src.matchAll(/play(?:Sfx|Bgm)\(\s*'([a-z0-9_]+)'/g)) ids.add(m[1]);
  return ids;
}

test('manifest 至少登记 13 个音频（11 音效 + 2 BGM）', () => {
  assert.ok(manifest.length >= 13,
    `manifest 只有 ${manifest.length} 条 —— 是不是被生成脚本覆盖了？跑 python tools/audio-manifest.py 重建`);
});

test('manifest 每条的音频文件真实存在', () => {
  for (const e of manifest) {
    assert.ok(e.file, `${e.id} 缺 file 字段`);
    assert.ok(existsSync(resolve(AUDIO, e.file)), `${e.id} -> ${e.file} 不存在`);
  }
});

test('游戏代码里 playSfx/playBgm 用到的 id 全部在 manifest 里', () => {
  const used = new Set([
    ...collectUsedIds('src/main.js'),
    ...collectUsedIds('src/render/audio.js'),
  ]);
  assert.ok(used.size > 0, '没扫到任何音频 id，正则可能失效了');

  const missing = [...used].filter((id) => !byId.has(id));
  assert.deepEqual(missing, [],
    `这些 id 被代码引用但 manifest 里没有，播放时会静默失败：${missing.join(', ')}`);
});

test('核心音效都在 manifest 里（攻击命中必须有声音）', () => {
  const required = ['sfx_hit', 'sfx_hit_heavy', 'sfx_hurt', 'sfx_dodge', 'sfx_special',
    'sfx_jump', 'sfx_knife', 'sfx_pickup', 'bgm_battle', 'bgm_boss'];
  const missing = required.filter((id) => !byId.has(id));
  assert.deepEqual(missing, [], `缺关键音频：${missing.join(', ')}`);
});

test('manifest 条目带版本哈希（音频重建后浏览器不吃旧缓存）', () => {
  const noVer = manifest.filter((e) => !e.version).map((e) => e.id);
  assert.deepEqual(noVer, [],
    `这些条目没有 version 哈希，浏览器可能继续用旧音频：${noVer.join(', ')}`);
});