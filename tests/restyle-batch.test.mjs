// restyle.mjs 的契约测试（不碰 GPU）。
//
// 守三条行为：
//   1) --batch N(N>1) 必须**显式拒绝**，不能静默产出丢结构锁的帧
//      （上游 comfy_extras/nodes_model_patch.py 的 ZImageControlPatch.prepare() 写死 self.image[:1]）
//   2) 默认逐帧路径不变（4 帧 = 4 次 prompt）
//   3) 断点续跑只跳过完整产物，半截 PNG 必须重跑
//
// 做法：起一个假 ComfyUI（/system_stats /object_info /prompt /history /view），
//       用真实 restyle.mjs 跑临时输入目录，数它提交了几次 prompt。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'tools', 'comfy', 'restyle.mjs');

const PY_PNG = (path, rgb) => `
from PIL import Image
Image.new('RGBA', (8, 8), ${rgb}).save(r'${path}')
`;

function python(code) {
  execFileSync('python', ['-c', code], { stdio: 'pipe' });
}

/** 起一个最小可用的假 ComfyUI。返回 {url, prompts, close}。 */
function startMockComfy(pngBytes) {
  const prompts = [];
  let nextId = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/system_stats') {
      return json(200, { system: { comfyui_version: '0.40.0' }, devices: [{ name: 'mock', vram_total: 8e9 }] });
    }
    if (url.pathname === '/object_info') {
      const names = (arr) => [arr];
      return json(200, {
        UnetLoaderGGUF: { input: { required: { unet_name: names(['z_image_turbo-Q5_K_M.gguf']) } } },
        CLIPLoaderGGUF: { input: { required: { clip_name: names(['Qwen3-4B-Q4_K_M.gguf']) } } },
        VAELoader: { input: { required: { vae_name: names(['ae.safetensors']) } } },
        ModelPatchLoader: { input: { required: { name: names(['Z-Image-Turbo-Fun-Controlnet-Union-2.1-lite-2602-8steps.safetensors']) } } },
      });
    }
    if (url.pathname === '/prompt' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const graph = JSON.parse(raw).prompt || {};
        const n = Object.values(graph).filter((nd) => nd.class_type === 'LoadImage').length || 1;
        const id = `mock-${nextId++}`;
        prompts.push({ id, graph, images: n });
        json(200, { prompt_id: id });
      });
      return;
    }
    if (url.pathname.startsWith('/history/')) {
      const id = url.pathname.split('/').pop();
      const rec = prompts.find((p) => p.id === id);
      if (!rec) return json(200, {});
      const images = Array.from({ length: rec.images }, (_, i) => ({ filename: `${id}_${String(i).padStart(5, '0')}.png`, subfolder: '', type: 'output' }));
      return json(200, { [id]: { status: { status_str: 'success', completed: true }, outputs: { '12': { images } } } });
    }
    if (url.pathname === '/view') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(pngBytes);
    }
    return json(404, { error: 'not found' });
  });

  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      res({ url: `http://127.0.0.1:${port}`, prompts, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** 造一个 4 帧输入目录：<in>/grunt/idle/idle_00..03.png */
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'restyle-test-'));
  const clip = join(dir, 'in', 'grunt', 'idle');
  mkdirSync(clip, { recursive: true });
  for (let i = 0; i < 4; i++) python(PY_PNG(join(clip, `idle_${String(i).padStart(2, '0')}.png`), '(255, 0, 0, 255)'));
  const green = join(dir, 'mock-output.png');
  python(PY_PNG(green, '(0, 255, 0, 255)'));
  return { dir, in: join(dir, 'in'), out: join(dir, 'out'), pngBytes: readFileSync(green) };
}

// 必须异步 spawn：execFileSync 会阻塞事件循环，同进程的 mock 服务就没法应答。
function runRestyle({ url, input, out, extraArgs = [] }) {
  const inputDir = join(tmpdir(), `comfy-input-${process.pid}-${Math.random().toString(36).slice(2)}`);
  return new Promise((res) => {
    const child = spawn('node', [SCRIPT, '--in', input, '--out', out, ...extraArgs], {
      cwd: ROOT,
      env: { ...process.env, COMFY_URL: url, COMFY_INPUT: inputDir },
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => res({ code, stderr }));
  });
}

test('--batch N>1 显式拒绝（上游 control 只吃第 1 帧，静默批量会丢结构锁）', async () => {
  const fx = makeFixture();
  const mock = await startMockComfy(fx.pngBytes);
  try {
    const { code, stderr } = await runRestyle({ url: mock.url, input: fx.in, out: fx.out, extraArgs: ['--batch', '4'] });
    assert.equal(code, 3, `期望退出码 3（拒绝），实际 ${code}`);
    assert.match(stderr, /image\[:1\]/, 'stderr 应说明上游写死 self.image[:1] 的原因');
    assert.equal(mock.prompts.length, 0, '拒绝时不应提交任何 prompt');
  } finally {
    await mock.close();
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('默认逐帧：4 帧 4 次 prompt，产物与输入同构', async () => {
  const fx = makeFixture();
  const mock = await startMockComfy(fx.pngBytes);
  try {
    const { code } = await runRestyle({ url: mock.url, input: fx.in, out: fx.out });
    assert.equal(code, 0);
    assert.equal(mock.prompts.length, 4, `期望 4 次 prompt，实际 ${mock.prompts.length} 次`);
    for (let i = 0; i < 4; i++) {
      const p = join(fx.out, 'grunt', 'idle', `idle_${String(i).padStart(2, '0')}.png`);
      assert.ok(readFileSync(p).equals(fx.pngBytes), `第 ${i} 帧未写到 ${p} 或内容不对`);
    }
  } finally {
    await mock.close();
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('续跑校验：半截 PNG 不能被当成已完成而跳过', async () => {
  const fx = makeFixture();
  const mock = await startMockComfy(fx.pngBytes);
  try {
    const truncated = join(fx.out, 'grunt', 'idle', 'idle_00.png');
    mkdirSync(dirname(truncated), { recursive: true });
    writeFileSync(truncated, fx.pngBytes.subarray(0, 40)); // 头都不完整

    const { code } = await runRestyle({ url: mock.url, input: fx.in, out: fx.out, extraArgs: ['--only', 'grunt'] });
    assert.equal(code, 0);
    assert.ok(mock.prompts.length >= 1, '半截文件应触发重跑，而不是被跳过');
    assert.ok(readFileSync(truncated).equals(fx.pngBytes), '半截文件应被重新生成覆盖');
  } finally {
    await mock.close();
    rmSync(fx.dir, { recursive: true, force: true });
  }
});