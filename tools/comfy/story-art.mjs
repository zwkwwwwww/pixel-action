// 剧情演出插画：**非像素**风格的视觉小说立绘与背景。
//
// 为什么单独一条管线：游戏本体是 480×270 像素风，但过场用精细插画能形成质感对比，
// 这是很多独立游戏的通行做法（像素战斗 + 高清叙事卡）。
//
// 用法: node tools/comfy/story-art.mjs [--only bg_intro_1,hero_portrait] [--force]
import { runAndSave, ping } from './client.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const UNET = 'z_image_turbo-Q5_K_M.gguf';
const CLIP = 'Qwen3-4B-Q4_K_M.gguf';
const VAE = 'ae.safetensors';

// 关键：明确禁止像素化，并指定绘画质感
const STYLE = 'dark fantasy digital painting, painterly brushwork, cinematic lighting, muted teal and amber palette, atmospheric haze, high detail illustration, concept art quality';
const NEG = 'pixel art, 8-bit, low resolution, blurry, text, watermark, signature, ui, frame, border, cartoon, chibi';

const ITEMS = [
  // ——— 开场背景（3 幕）———
  {
    id: 'bg_intro_1',
    w: 1120, h: 630, seed: 9101,
    prompt: `${STYLE}, a colossal rusted moon hanging low over a dead city skyline, ash drifting in the air, ruined spires silhouetted, embers rising, no characters, wide establishing shot`,
  },
  {
    id: 'bg_intro_2',
    w: 1120, h: 630, seed: 9202,
    prompt: `${STYLE}, narrow ruined street of black iron at night, rusted gates and broken lanterns, wet cobblestone reflecting amber light, fog, empty, no characters, low camera angle`,
  },
  {
    id: 'bg_intro_3',
    w: 1120, h: 630, seed: 9303,
    prompt: `${STYLE}, a ruined clock tower silhouetted against a blood moon, cracked stone steps leading up, chains and torn banners, floating embers, no characters, dramatic upward view`,
  },
  // ——— 结局背景 ———
  {
    id: 'bg_ending',
    w: 1120, h: 630, seed: 9404,
    prompt: `${STYLE}, the same ruined clock tower at dawn, the rusted moon fading pale in a clearing sky, first light through broken clouds, ash settling on the ground, calm and quiet mood, no characters`,
  },
  // ——— 角色立绘（纯黑背景便于色键抠图）———
  {
    id: 'hero_portrait',
    w: 832, h: 1152, seed: 9505,
    prompt: `${STYLE}, full body portrait of a lone female swordswoman, worn blue long coat, red scarf, holding a single chipped longsword point down, short red hair, tired determined expression, standing, isolated on a pure black background, dramatic rim lighting`,
  },
  {
    id: 'warden_portrait',
    w: 832, h: 1152, seed: 9606,
    prompt: `${STYLE}, full body portrait of a tall hooded sorcerer in violet robes, face hidden in shadow, glowing jade staff with a floating orb, eerie magical aura, isolated on a pure black background, dramatic rim lighting`,
  },
];

function workflow(prompt, seed, w, h) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: UNET } },
    '2': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: CLIP, type: 'lumina2' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: VAE } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    '5': { class_type: 'TextEncodeZImageOmni', inputs: { clip: ['2', 0], prompt, auto_resize_images: true } },
    '6': { class_type: 'TextEncodeZImageOmni', inputs: { clip: ['2', 0], prompt: NEG, auto_resize_images: true } },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['4', 0],
        seed, steps: 9, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'dsh_story' } },
  };
}

/** 背景：等比缩到宽 960，居中裁 540（游戏内 480x270 的 2 倍）。 */
function finishBg(raw, out) {
  execFileSync('python', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w = 960
h = round(im.height * w / im.width)
im = im.resize((w, h), Image.LANCZOS)
top = max(0, (h - 540) // 2)
im = im.crop((0, top, w, top + 540))
im.save(sys.argv[2], optimize=True)
`, raw, out], { stdio: 'inherit' });
}

/**
 * 立绘：把接近纯黑的背景抠成透明。
 * 阈值法对 "isolated on pure black" 的图很稳；再对边缘做一次羽化避免硬锯齿。
 */
function finishPortrait(raw, out) {
  execFileSync('python', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
w, h = im.size
target_w = 420
target_h = round(h * target_w / w)
im = im.resize((target_w, target_h), Image.LANCZOS)
px = im.load()
TH = 26          # 低于这个亮度视为背景
for y in range(target_h):
    for x in range(target_w):
        r, g, b, a = px[x, y]
        lum = (r * 299 + g * 587 + b * 114) // 1000
        if lum <= TH:
            px[x, y] = (r, g, b, 0)
        elif lum < TH * 2:
            # 边缘过渡：按亮度给半透明，避免黑边
            px[x, y] = (r, g, b, int(255 * (lum - TH) / TH))
im.save(sys.argv[2], optimize=True)
`, raw, out], { stdio: 'inherit' });
}

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const only = opt('only') ? new Set(opt('only').split(',')) : null;
const force = argv.includes('--force');

await ping();
mkdirSync('art-source/comfy/story', { recursive: true });
mkdirSync('assets/story', { recursive: true });

for (const it of ITEMS) {
  if (only && !only.has(it.id)) continue;
  const isPortrait = it.id.endsWith('_portrait');
  const raw = `art-source/comfy/story/${it.id}.png`;
  const fin = `assets/story/${it.id}.png`;
  if (!force && existsSync(fin)) { console.log(`skip ${it.id}`); continue; }

  if (force || !existsSync(raw)) {
    const t0 = Date.now();
    const res = await runAndSave(workflow(it.prompt, it.seed, it.w, it.h), raw, {
      timeoutMs: Number(process.env.COMFY_TIMEOUT_MS || 900000),
    });
    console.log(`${it.id} 生成 ${Date.now() - t0}ms ${res.bytes}B`);
  }
  if (isPortrait) finishPortrait(raw, fin);
  else finishBg(raw, fin);
  console.log(`✓ ${fin}`);
}
