// 冒烟测试：确认 Z-Image-Turbo 基座能在本机跑通（txt2img，8 步 / cfg 1）。
// 用法: node tools/comfy/smoke.mjs
import { runAndSave, ping, assertModels, COMFY } from './client.mjs';

const ZIMAGE = {
  unet: { type: 'unet', name: 'z_image_turbo-Q5_K_M.gguf' },
  clip: { type: 'clip', name: 'Qwen3-4B-Q4_K_M.gguf' },
  vae: { type: 'vae', name: 'ae.safetensors' },
};

const PROMPT = 'pixel art game sprite, female swordswoman, side view, limited palette, sharp pixels, transparent background';
const NEG = 'blurry, photo, 3d render, noise';

function workflow(seed) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: ZIMAGE.unet.name } },
    '2': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: ZIMAGE.clip.name, type: 'lumina2' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: ZIMAGE.vae.name } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '5': { class_type: 'TextEncodeZImageOmni', inputs: { clip: ['2', 0], prompt: PROMPT, auto_resize_images: true } },
    '6': { class_type: 'TextEncodeZImageOmni', inputs: { clip: ['2', 0], prompt: NEG, auto_resize_images: true } },
    '7': { class_type: 'KSampler', inputs: {
      model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['4', 0],
      seed, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
    } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'dsh_smoke' } },
  };
}

const t0 = Date.now();
const stats = await ping();
console.log(`ComfyUI OK @ ${COMFY} | torch ${stats.system?.pytorch_version ?? '?'} | vram ${Math.round((stats.system?.devices?.[0]?.vram_total ?? 0) / 1e6)}MB`);
await assertModels(Object.values(ZIMAGE));
console.log('模型齐全');

const res = await runAndSave(workflow(1001), 'art-source/comfy/smoke.png', { timeoutMs: 300000 });
console.log(JSON.stringify({ ...res, ms: Date.now() - t0 }));
