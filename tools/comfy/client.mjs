// 极简 ComfyUI HTTP 客户端：排队 / 等结果 / 取图 / 上传输入。
// 直连 HTTP，不依赖 MCP 会话（MCP 进程到本机端口的传输不可靠）。
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';

export const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8888';
// ComfyUI 的输入/输出目录（本机共享池）
export const COMFY_INPUT = process.env.COMFY_INPUT || 'E:/Comfy-Desktop/ComfyUI-Shared/input';

export async function ping() {
  const r = await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`ComfyUI HTTP ${r.status}`);
  return r.json();
}

/** 把本地图片放进 ComfyUI 的 input/，返回 LoadImage 可用的文件名。 */
export async function uploadInput(localPath) {
  const name = basename(localPath);
  await mkdir(COMFY_INPUT, { recursive: true });
  await copyFile(localPath, resolve(COMFY_INPUT, name));
  return name;
}

export async function queue(workflow, clientId = 'dsh-pixel-action') {
  const r = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const j = await r.json();
  if (!r.ok || j.error) {
    throw new Error(`排队失败: ${JSON.stringify(j.error || j.node_errors || j).slice(0, 900)}`);
  }
  return j.prompt_id;
}

export async function waitFor(promptId, { timeoutMs = 300000, pollMs = 700 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`${COMFY}/history/${promptId}`);
    const h = await r.json();
    const entry = h[promptId];
    if (entry) {
      if (entry.status?.status_str === 'error' || entry.status?.completed === false) {
        const msg = entry.status?.messages?.find((m) => m[0] === 'execution_error');
        throw new Error(`执行失败: ${JSON.stringify(msg || entry.status).slice(0, 1200)}`);
      }
      return entry;
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
  throw new Error(`等待超时（${timeoutMs}ms）: ${promptId}`);
}

/** 从 history 条目里找第一张输出图并落盘。 */
export async function saveFirstImage(historyEntry, outPath) {
  const outs = historyEntry.outputs || {};
  for (const nodeId of Object.keys(outs)) {
    const imgs = outs[nodeId].images || [];
    for (const img of imgs) {
      if (!img.filename) continue;
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
      const r = await fetch(`${COMFY}/view?${q}`);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, buf);
      return { path: outPath, bytes: buf.length, nodeId, filename: img.filename };
    }
  }
  throw new Error('history 里没有输出图');
}

/** 一次跑完：排队 → 等待 → 取图。 */
export async function runAndSave(workflow, outPath, opts = {}) {
  const id = await queue(workflow, opts.clientId);
  const hist = await waitFor(id, opts);
  const saved = await saveFirstImage(hist, outPath);
  return { promptId: id, ...saved };
}

/** 便捷：检查必需模型是否都在 */
export async function assertModels(list) {
  const r = await fetch(`${COMFY}/object_info`);
  const o = await r.json();
  const missing = [];
  for (const m of list) {
    let found = false;
    if (m.type === 'unet') found = o.UnetLoaderGGUF.input.required.unet_name[0].includes(m.name);
    if (m.type === 'clip') found = o.CLIPLoaderGGUF.input.required.clip_name[0].includes(m.name);
    if (m.type === 'vae') found = o.VAELoader.input.required.vae_name[0].includes(m.name);
    if (m.type === 'patch') found = o.ModelPatchLoader.input.required.name[0].includes(m.name);
    if (!found) missing.push(`${m.type}:${m.name}`);
  }
  if (missing.length) throw new Error(`ComfyUI 缺少模型: ${missing.join(', ')}`);
  return true;
}

export { readFile, writeFile, existsSync };
