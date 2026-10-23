// ComfyUI 像素化重塑：把 Blender 的平面渲染帧交给 Z-Image-Turbo + Fun-ControlNet(Union)，
// 在「结构锁死」的前提下补出像素画的细节与光影。
//
// 为什么要 ControlNet 而不是纯 img2img：纯 img2img 会让模型自由重画轮廓，帧与帧之间腿会漂移，
// 动起来就是「抽搐」。ControlNet 把 Blender 的轮廓/色块当成骨架，denoise 只改材质细节。
//
// 用法:
//   node tools/comfy/restyle.mjs --in tmp/px-hero-384 --out tmp/restyled --prompt "..." \
//        [--strength 0.8] [--denoise 0.55] [--seed 4242] [--res 384] [--only idle,walk]
//
// 断点续跑：只跳过「PNG 头部合法且尺寸与源帧一致」的产物；半截文件会重跑。
// --batch N（N>1）目前被显式拒绝，原因见下方 BATCH 守卫（上游 control 只吃第 1 帧）。
//
// 产物：与输入同结构的 384×384 RGB PNG（alpha 由后续 compose_final.py 从 Blender 原帧取回）。
import { readdir, mkdir, readFile } from 'node:fs/promises';
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { runAndSave, uploadInput, ping, assertModels, COMFY } from './client.mjs';

const UNET = 'z_image_turbo-Q5_K_M.gguf';
const CLIP = 'Qwen3-4B-Q4_K_M.gguf';
const VAE = 'ae.safetensors';
const PATCH = 'Z-Image-Turbo-Fun-Controlnet-Union-2.1-lite-2602-8steps.safetensors';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const IN = opt('in');
const OUT = opt('out');
if (!IN || !OUT) { console.error('用法: --in <dir> --out <dir>'); process.exit(2); }
const PROMPT = opt('prompt', 'pixel art game sprite, detailed pixel art, crisp limited palette, hand-painted pixel shading, sharp edges, side view, plain background');
const NEG = opt('negative', 'blurry, photo, 3d render, gradient mesh, noise, grain, jpeg artifacts, anti-aliasing, text, watermark');
const STRENGTH = Number(opt('strength', 0.82));
const DENOISE = Number(opt('denoise', 0.55));
const SEED = Number(opt('seed', 4242));
const RES = Number(opt('res', 384));
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
const BATCH = Number(opt('batch', 1)) || 1;

// 批量提交目前是**不安全**的，直接拒绝而不是静默产出错帧：
// comfy_extras/nodes_model_patch.py 的 ZImageControlPatch.prepare() 里写死了
//     image = comfy.utils.common_upscale(self.image[:1].movedim(-1, 1), ...)
// 即一次 prompt 里 ControlNet 只会用批次的第 1 帧；第 2..N 帧拿不到结构锁，
// 腿/武器会漂移——正是这条管线要防的问题。等上游支持逐帧 control 再放开。
if (BATCH > 1) {
  console.error(
    `拒绝执行 --batch ${BATCH}：本机 ComfyUI 的 ZImageControlPatch.prepare() 写死了 self.image[:1]，\n` +
    `一次 prompt 内 ControlNet 只作用于第 1 帧，第 2..${BATCH} 帧会失去结构锁（帧间漂移）。\n` +
    `详见 comfy_extras/nodes_model_patch.py:654。批量必须等上游支持逐帧 control。`,
  );
  process.exit(3);
}

function workflow(imageName, seed) {
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: UNET } },
    '2': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: CLIP, type: 'lumina2' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: VAE } },
    '4': { class_type: 'LoadImage', inputs: { image: imageName } },
    '5': { class_type: 'ModelPatchLoader', inputs: { name: PATCH } },
    '6': { class_type: 'ZImageFunControlnet', inputs: {
      model: ['1', 0], model_patch: ['5', 0], vae: ['3', 0],
      strength: STRENGTH, image: ['4', 0], start_percent: 0, end_percent: 1,
    } },
    '7': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['3', 0] } },
    '8': { class_type: 'TextEncodeZImageOmni', inputs: { clip: ['2', 0], prompt: PROMPT, auto_resize_images: true } },
    '9': { class_type: 'TextEncodeZImageOmni', inputs: { clip: ['2', 0], prompt: NEG, auto_resize_images: true } },
    '10': { class_type: 'KSampler', inputs: {
      model: ['6', 0], positive: ['8', 0], negative: ['9', 0], latent_image: ['7', 0],
      seed, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: DENOISE,
    } },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
    '12': { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: 'dsh_restyle' } },
  };
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue; // 跳过 _cell96 / 中间产物
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (extname(e.name).toLowerCase() === '.png') out.push(p);
  }
  return out.sort();
}

/** 读 PNG 的 IHDR（宽/高/字节数）；不是完整可解码的 PNG 就返回 null。
 *  用途：续跑时只跳过**真正完整**的产物，被 kill 掉的半截文件必须重跑。 */
function pngInfo(p) {
  try {
    const bytes = statSync(p).size;
    if (bytes < 1024) return null;
    const fd = openSync(p, 'r');
    const head = Buffer.alloc(24);
    const n = readSync(fd, head, 0, 24, 0);
    closeSync(fd);
    if (n < 24) return null;
    if (head.readUInt32BE(0) !== 0x89504e47 || head.readUInt32BE(4) !== 0x0d0a1a0a) return null;
    if (head.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { w: head.readUInt32BE(16), h: head.readUInt32BE(20), bytes };
  } catch { return null; }
}

async function main() {
  const t0 = Date.now();
  const stats = await ping();
  const vram = stats.devices?.[0]?.vram_total ?? stats.system?.devices?.[0]?.vram_total ?? 0;
  console.log(`ComfyUI OK · VRAM ${Math.round(vram / 1e6)}MB`);
  await assertModels([
    { type: 'unet', name: UNET }, { type: 'clip', name: CLIP },
    { type: 'vae', name: VAE }, { type: 'patch', name: PATCH },
  ]);

  const files = await walk(IN);
  if (!files.length) throw new Error(`${IN} 里没有 PNG`);
  let done = 0; let skipped = 0; const timings = [];

  for (const f of files) {
    const rel = relative(IN, f);
    const parts = rel.split(/[\\/]/);
    const clip = parts[0];
    // --only 既接受角色目录名，也接受剪辑目录名（enemies/grunt/idle/...）
    if (ONLY && !ONLY.has(parts[0]) && !ONLY.has(parts[1])) continue;
    const dst = join(OUT, rel);
    // 只跳过完整产物：解码头合法且尺寸与源帧一致；半截/损坏文件一律重跑
    const srcInfo = pngInfo(f);
    const dstInfo = pngInfo(dst);
    if (dstInfo && srcInfo && dstInfo.w === srcInfo.w && dstInfo.h === srcInfo.h) { skipped++; continue; }

    // ComfyUI 的 LoadImage 不接受透明图：铺一层中灰再送进去（alpha 后面再贴回来）
    const { execFileSync } = await import('node:child_process');
    const flat = join('tmp', '.comfy-flat', rel);
    await mkdir(dirname(flat), { recursive: true });
    execFileSync('python', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
bg = Image.new('RGBA', im.size, (40, 42, 52, 255))
bg.alpha_composite(im)
bg.convert('RGB').save(sys.argv[2])
`, f, flat], { stdio: 'inherit' });
    const name = await uploadInput(flat);

    const started = Date.now();
    // 同一剪辑共用一个种子：噪声相关，帧间更稳
    const res = await runAndSave(workflow(name, SEED), dst, { timeoutMs: Number(process.env.COMFY_TIMEOUT_MS || 600000) });
    const ms = Date.now() - started;
    timings.push({ file: rel, ms, bytes: res.bytes, promptId: res.promptId });
    done++;
    console.log(`[${done}] ${rel}  ${ms}ms  ${res.bytes}B`);
  }

  const totalMs = Date.now() - t0;
  await mkdir(OUT, { recursive: true });
  const report = { in: IN, out: OUT, prompt: PROMPT, strength: STRENGTH, denoise: DENOISE, seed: SEED, res: RES, done, skipped, totalMs, avgMs: timings.length ? Math.round(timings.reduce((s, t) => s + t.ms, 0) / timings.length) : 0, timings };
  await import('node:fs').then(({ writeFileSync }) => writeFileSync(join(OUT, '_restyle_report.json'), JSON.stringify(report, null, 2)));
  console.log(JSON.stringify({ done, skipped, totalMs, avgMs: report.avgMs }));
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
