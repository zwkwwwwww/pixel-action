// 用本地 ComfyUI 的 ACE-Step 1.5 生成游戏音效与 BGM（不引外部版权素材）。
// 用法: node tools/comfy/audio-batch.mjs [--only sfx_hit,bgm_battle] [--force]
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8888';
const UNET = 'acestep_v1.5_turbo.safetensors';
const CLIP1 = 'qwen_0.6b_ace15.safetensors';
const CLIP2 = 'qwen_4b_ace15.safetensors';
const VAE = 'ace_1.5_vae.safetensors';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const outDir = resolve('assets/audio');
const only = opt('only') ? new Set(opt('only').split(',')) : null;
const force = argv.includes('--force');
const seedOffset = Number(opt('seed-offset', force ? 5000 : 0));

/** [id, seconds, tags, bpm, keyscale] */
const AUDIO = [
  ['sfx_swing', 1, 'fast sword swing whoosh, air slash, short game attack sound effect, no music', 140, 'A minor'],
  ['sfx_hit', 1, 'heavy metal blade impact on armor, sharp crunch, short game hit sound effect, no music', 120, 'C minor'],
  ['sfx_dodge', 1, 'quick cloth and boot dodge whoosh, short game evade sound effect, no music', 150, 'D minor'],
  ['sfx_special', 3, 'dark energy slash burst, low rumble and sharp magic crack, game special attack sound, no music', 120, 'E minor'],
  ['sfx_death', 2, 'low dying groan and armor clatter, dark fantasy enemy defeat sound, no music', 90, 'C minor'],
  ['sfx_victory', 4, 'short dark fantasy victory stinger, triumphant brass and choir hit, game win jingle', 120, 'A major'],
  ['bgm_battle', 32, 'dark fantasy beat em up battle music, driving war drums, low strings ostinato, rusted industrial percussion, tense and heroic, instrumental', 132, 'D minor'],
  ['bgm_boss', 28, 'boss battle music, ominous choir, heavy taiko drums, distorted brass, relentless, instrumental', 140, 'C minor'],
];

function graph(seconds, tags, bpm, keyscale, seed, id) {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: UNET, weight_dtype: 'default' } },
    '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: CLIP1, clip_name2: CLIP2, type: 'ace' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: VAE } },
    '4': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
    '5': { class_type: 'EmptyAceStep1.5LatentAudio', inputs: { seconds, batch_size: 1 } },
    '6': { class_type: 'TextEncodeAceStepAudio1.5', inputs: {
      clip: ['2', 0], tags, lyrics: '', seed, bpm, duration: seconds,
      timesignature: '4', language: 'en', keyscale,
      generate_audio_codes: true, cfg_scale: 2, temperature: 0.85,
      top_p: 0.9, top_k: 0, min_p: 0,
    } },
    '7': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } },
    '8': { class_type: 'KSampler', inputs: {
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      seed, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
    } },
    '9': { class_type: 'VAEDecodeAudio', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveAudioMP3', inputs: { audio: ['9', 0], filename_prefix: `rm_audio/${id}`, quality: '320k' } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(outDir, { recursive: true });
mkdirSync('art-source/audio', { recursive: true });
let done = 0; let skipped = 0; let failed = 0;
const manifest = [];

for (let i = 0; i < AUDIO.length; i++) {
  const [id, seconds, tags, bpm, keyscale] = AUDIO[i];
  if (only && !only.has(id)) continue;
  const dest = resolve(outDir, `${id}.mp3`);
  manifest.push({ id, seconds, file: `${id}.mp3` });
  if (existsSync(dest) && !force) { skipped++; console.log(`跳过(已存在) ${id}`); continue; }

  const seed = 2000 + i + seedOffset;
  try {
    const t0 = Date.now();
    const res = await fetch(`${COMFY}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph(seconds, tags, bpm, keyscale, seed, id), client_id: 'audio-batch' }),
    });
    if (!res.ok) throw new Error(`/prompt ${res.status} ${(await res.text()).slice(0, 300)}`);
    const { prompt_id } = await res.json();

    let files = null;
    for (let t = 0; t < 900; t++) {
      await sleep(1000);
      const hr = await fetch(`${COMFY}/history/${prompt_id}`);
      if (!hr.ok) continue;
      const rec = (await hr.json())[prompt_id];
      if (!rec) continue;
      if (rec.status?.status_str === 'error') throw new Error(`ComfyUI 执行报错: ${JSON.stringify(rec.status).slice(0, 400)}`);
      const out = rec.outputs?.['10'];
      const audio = out?.audio ?? out?.images;
      if (audio?.length) { files = audio; break; }
    }
    if (!files) throw new Error('等待出音频超时(900s)');
    const f = files[0];
    const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' });
    const vr = await fetch(`${COMFY}/view?${q}`);
    if (!vr.ok) throw new Error(`/view ${vr.status}`);
    const buf = Buffer.from(await vr.arrayBuffer());
    writeFileSync(dest, buf);
    writeFileSync(resolve('art-source/audio', `${id}.mp3`), buf);
    done++;
    console.log(`OK ${id} seed=${seed} ${Math.round((Date.now() - t0) / 1000)}s ${buf.length}B`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${id}: ${e.message}`);
  }
}

writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n完成: 新生成 ${done} / 跳过 ${skipped} / 失败 ${failed} → ${outDir}`);
if (failed) process.exit(1);
