// 关卡背景：用 Z-Image-Turbo 出宽幅像素场景，再压到游戏用的 960×270（两屏宽，供视差滚动）。
// 用法: node tools/comfy/backgrounds.mjs [--only bg_level,bg_boss] [--force]
import { runAndSave, ping } from './client.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const UNET = 'z_image_turbo-Q5_K_M.gguf';
const CLIP = 'Qwen3-4B-Q4_K_M.gguf';
const VAE = 'ae.safetensors';

const STYLE = 'pixel art background, 16-bit game stage art, side-scrolling beat em up backdrop, hard pixel edges, limited palette, dithering, crisp pixels, no characters, no text';
const NEG = 'characters, people, human, text, watermark, signature, blurry, photo, 3d render, smooth gradient, anti-aliasing';

const ITEMS = [
  {
    id: 'bg_level',
    seed: 7101,
    prompt: `${STYLE}, ruined moonlit city street at night, rusted iron gates, broken neon signs, wet cobblestone, distant towers, orange lanterns, teal shadows, cinematic wide shot, empty street`,
  },
  {
    id: 'bg_boss',
    seed: 7202,
    prompt: `${STYLE}, vast ruined plaza before a colossal clock tower, cracked stone floor, floating embers, blood moon, chains and banners, ominous teal and crimson palette, wide shot, empty arena`,
  },
  {
    id: 'bg_title',
    seed: 7303,
    prompt: `${STYLE}, panoramic ruined city skyline under a huge rusted moon, ruined spires, drifting ash, deep blue and amber, epic key visual, no characters, wide shot`,
  },
];

function workflow(prompt, seed) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: UNET } },
    '2': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: CLIP, type: 'lumina2' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: VAE } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 1280, height: 720, batch_size: 1 } },
    '5': { class_type: 'TextEncodeZImageOmni', inputs: { clip: ['2', 0], prompt, auto_resize_images: true } },
    '6': { class_type: 'TextEncodeZImageOmni', inputs: { clip: ['2', 0], prompt: NEG, auto_resize_images: true } },
    '7': { class_type: 'KSampler', inputs: {
      model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['4', 0],
      seed, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
    } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'dsh_bg' } },
  };
}

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const only = opt('only') ? new Set(opt('only').split(',')) : null;
const force = argv.includes('--force');

await ping();
mkdirSync('art-source/comfy/bg', { recursive: true });
mkdirSync('assets/bg', { recursive: true });

for (const it of ITEMS) {
  if (only && !only.has(it.id)) continue;
  const raw = `art-source/comfy/bg/${it.id}.png`;
  const fin = `assets/bg/${it.id}.png`;
  if (!force && existsSync(fin)) { console.log(`skip ${it.id}`); continue; }
  if (force || !existsSync(raw)) {
    const t0 = Date.now();
    const res = await runAndSave(workflow(it.prompt, it.seed), raw, { timeoutMs: 600000 });
    console.log(`${it.id} 生成 ${Date.now() - t0}ms ${res.bytes}B`);
  }
  // 1280x720 → 960x270：先等比缩到宽 960，再居中裁出 270 高（保留天空与地面，去掉多余）
  execFileSync('python', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w = 960
h = round(im.height * w / im.width)
im = im.resize((w, h), Image.LANCZOS)
top = max(0, (h - 270) // 2)
im = im.crop((0, top, w, top + 270))
im = im.quantize(colors=48, method=Image.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
im.save(sys.argv[2])
`, raw, fin], { stdio: 'inherit' });
  console.log(`✓ ${fin}`);
}
