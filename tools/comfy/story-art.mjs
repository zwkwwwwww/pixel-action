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
 * 立绘抠图：**从画面四边做洪水填充**，只抠掉与边缘连通的暗区。
 *
 * 为什么不用纯阈值：角色本身有大量暗部（深蓝外套、靴子、剑刃），
 * 阈值法会把这些也抠成透明，只剩一个幽灵轮廓（已实际发生）。
 * 洪水填充能区分"背景黑"和"角色内部的黑"——后者被亮部包围，不会被填到。
 *
 * 边缘处理：与背景相邻的 1~2 像素按亮度给半透明，消除硬锯齿。
 */
function finishPortrait(raw, out) {
  execFileSync('python', ['-c', `
import sys
import numpy as np
from PIL import Image

# 不做色键抠图。
#
# 为什么放弃：AI 生成的立绘自带**暗角/轮廓光**，那些暗部和角色粗壮相连 ——
# 亮度阈值会把角色的深色外套一起吃掉（"抠多了"）；
# 洪水填充虽能保住角色，却留下一圈和角色连在一起的黑色残块（亮背景上极明显）。
#
# 改用**椭圆软蒙版**：保留原图，只让边缘平滑淡出。
# 立绘自带的暗背景于是成为刻意的暗角，在暗场景里完全隐形。
# 代价：它不适合直接叠在明亮天空上 —— 所以结局场景不使用立绘。
im = Image.open(sys.argv[1]).convert('RGBA')
w, h = im.size
tw = 460
th = round(h * tw / w)
im = im.resize((tw, th), Image.LANCZOS)
a = np.asarray(im).copy()

ys, xs = np.mgrid[0:th, 0:tw]
cx, cy = (tw - 1) / 2.0, (th - 1) / 2.0
nx = (xs - cx) / (tw * 0.53)
ny = (ys - cy) / (th * 0.55)
r = np.sqrt(nx * nx + ny * ny)

# smoothstep：r<=0.82 全不透明，r>=1.05 全透明
t = np.clip((r - 0.82) / (1.05 - 0.82), 0.0, 1.0)
fade = 1.0 - (t * t * (3.0 - 2.0 * t))
a[..., 3] = (a[..., 3].astype(float) * fade).astype(np.uint8)

Image.fromarray(a, 'RGBA').save(sys.argv[2], optimize=True)
print(f'  soft-mask portrait: {tw}x{th} (no color keying)')
`, raw, out], { stdio: 'inherit' });
}

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const only = opt('only') ? new Set(opt('only').split(',')) : null;
const force = argv.includes('--force');
const rematte = argv.includes('--rematte');

// --rematte 只重做抠图，不需要 ComfyUI 在线
if (!argv.includes('--rematte')) await ping();
mkdirSync('art-source/comfy/story', { recursive: true });
mkdirSync('assets/story', { recursive: true });

for (const it of ITEMS) {
  if (only && !only.has(it.id)) continue;
  const isPortrait = it.id.endsWith('_portrait');
  const raw = `art-source/comfy/story/${it.id}.png`;
  const fin = `assets/story/${it.id}.png`;
  if (!rematte && !force && existsSync(fin)) { console.log(`skip ${it.id}`); continue; }

  if (!rematte && (force || !existsSync(raw))) {
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
