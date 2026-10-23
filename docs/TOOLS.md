# 工具地图（Tools）

> 这个项目没有引擎编辑器，所有美术/音频都是**脚本产物**。所以工具分成两类：
> 「**生产工具**」（把源变成资产）和「**闸门工具**」（不合格就非零退出，拦住人）。
> 一条命令 `bash tools/build-sprites.sh hero` 实际串起了其中 6 个。

---

## 0. 总管线

```
Blender 脚本           ComfyUI 重塑            像素后处理            闸门              打包
build_*.py     →     restyle.mjs        →    compose_final.py  → frame_diff.py  →  pack_sprites.py
(建模+骨骼+动作)      (ControlNet 结构锁)      (固定框+BOX+调色板)  pivot_drift.py     (表+JSON+version)
   ↓                     ↓                        ↓               walk_gate.py            ↓
.blend 入库          tmp/restyle-*/            tmp/final-*/                          assets/sprites/
                                                                                      ↓
                                                                                   游戏加载
```

音频是独立支线：`sfx-synth.py`（DSP）+ `voice-fx.py`（TTS 后期）→ `audio-manifest.py` → 游戏。

---

## 1. Blender：建模、骨骼、渲染（`tools/blender/`）

| 工具 | 作用 | 输入 → 输出 |
|---|---|---|
| `build_hero.py` | 用 bpy **从零生成** hero.blend：低模（619 顶点）、9 根刚性骨、9 组 action | 无 → `art-source/blender/hero.blend` |
| `enemies/build_enemies.py` | 同上，四个敌人/Boss（`--kind grunt\|brute\|ranger\|boss`） | 无 → `enemies/*.blend` |
| `render_clips.py` | 无头渲染每个 clip 的透明 PNG（正交 3/4 视角） | `.blend` → `art-source/blender/<name>/<clip>/*.png` + `_render_report.json` |
| `inspect_blend.py` | 打印场景 JSON（对象/骨骼/材质/分辨率），排查用 | `.blend` → stdout |
| `enemies/inspect.py` | 逐帧放大检查条（5x，Boss 3x），作者目视用 | 渲染帧 → `_inspect/<kind>-<clip>.png` |
| `verify_clips.py` / `verify_enemies.py` | **契约闸门**：帧数、尺寸、出画、透明度是否合规 | 渲染帧 → 报告 + 退出码 |
| `make_evidence.py` / `make_sheets.py` | 生成人工验收图（全剪辑总览 + 锚点检查） | 渲染帧 → `art-source/evidence/*.png` |
| `README.md` | 这套脚本的参数与坑 | — |

> 定位：Blender 在这里不是"游戏引擎资产来源"，而是**离线精灵烘焙器**——只负责"结构正确"。

## 2. ComfyUI：把色块变成像素画质感（`tools/comfy/`）

| 工具 | 作用 | 输入 → 输出 |
|---|---|---|
| `client.mjs` | 极简 ComfyUI HTTP 客户端（上传/排队/轮询/取图/模型断言）。**直连 HTTP，不依赖 MCP 会话** | — → API 封装 |
| `restyle.mjs` | img2img + Fun-ControlNet 结构锁逐帧重塑；续跑只跳过完整产物；`--batch>1` 会显式拒绝（上游只吃第 1 帧） | 384px Blender 帧 → 384px RGB |
| `restyle-*.sh` | 增量重跑包装（hero / enemies / denser） | — |
| `_restart_with_manager.ps1` | 用 `--enable-manager` 重启 ComfyUI（含 BOM/`$args` 两个坑的注释） | — |
| `backgrounds.mjs` | Z-Image 生成宽幅场景 → 960×270（两屏宽，供视差） | prompt → `assets/bg/*.png` |
| `audio-batch.mjs` | ACE-Step 1.5 生成 BGM（早期也生成音效，现已改用 DSP/TTS） | prompt → `assets/audio/*.mp3` |
| `smoke.mjs` | 基座冒烟：Z-Image 8 步/cfg1 能不能跑通 | — |

## 3. 像素后处理（`tools/*.py`）

| 工具 | 作用 | 为什么需要 |
|---|---|---|
| `compose_final.py` | 把重塑后的帧压回像素网格：**固定裁剪框** + **预乘 alpha 的 BOX 下采样** + 全局调色板 + 贴回 Blender alpha；输出 `_compose.json` 变换清单 | 逐帧 bbox 居中会让角色攻击时横移 17px；LANCZOS 会把轮廓外的 AI 灰底渗进边缘 |
| `pixelize.py` | 早期的独立像素化（二值化→裁剪→NEAREST→受限色板）。现在主链路用 `compose_final`，它保留作单帧/对照 | — |
| `palette.py` | 固化 **≤48 色全局调色板**（`art-source/palette.png` + `.json`） | 逐帧量化会让一张表 1237 色、5 张表只共有 4 色 |
| `pack_sprites.py` | 打包精灵表 + JSON（`cell/anchor/clips/fps/version`）；校验帧号连续、cell 尺寸；`--skip` 丢帧 | 游戏只认这一份清单；`version` 是缓存键 |

## 4. 闸门：不合格就失败（这是项目质量的核心）

| 闸门 | 判据 | 想拦住什么 |
|---|---|---|
| `frame_diff.py` | 只在**剪影交集**上算相邻帧差 + 循环缝合判定 | 帧间闪烁（旧口径在整 cell 上算，阈值 0.22 数学上不可达） |
| `pivot_drift.py` | 同一剪辑内 `(裁剪框,缩放,粘贴位置)` **必须唯一** | 攻击/受击时的横向滑步（后处理平移，重渲染修不好） |
| `walk_gate.py` | 禁止**相邻两帧都接近双腿直立** | 直立姿势被保持 125ms → 视觉暂留成"残影" |
| `verify_clips.py` / `verify_enemies.py` | Blender 侧契约 | 缺帧、尺寸错、出画 |
| （内建）`pack_sprites.py` | 帧号连续、尺寸==cell | 半成品入库 |
| `pixel-drift` 类检查 | `--expect` 可选帧数断言 | 改动作时漏渲 |

## 5. 编排脚本（把上面串起来）

| 脚本 | 流程 |
|---|---|
| `build-sprites.sh <name>` | restyle → compose → frame_diff → pivot_drift → pack → walk_gate |
| `build-enemy-sprites.sh` | 四个敌人循环同上（带 per-character `--skip`） |
| `build-palette.sh` | 两遍法：先**无量化**合成采样 → `palette.py` 固化 → 之后所有 compose 复用 |

## 6. 音频

| 工具 | 作用 |
|---|---|
| `sfx-synth.py` | DSP 合成：命中/重击/弓/闪避/死亡/必杀。手法是**指数扫频 + 软削波 + 无混响**（音乐模型做不了短促干声） |
| `voice-fx.py` | 把百炼 TTS 的人声做成资产：裁静音 → 截时长 → 受击补低频冲击（TTS 起音 53ms 会"软"）→ 归一化 |
| `audio-manifest.py` | 生成清单，每条带 **SHA256 version** → 音频重建后 URL 变化，浏览器不缓存旧的 |
| `audio-analyze.py` | 新旧音效客观对比（起音/频谱质心/时长） |

## 7. 取证与浏览器探针

| 工具 | 作用 |
|---|---|
| `browser-probe.mjs` | 无头 Chrome/CDP：打开页面、注入脚本、截图、收集 console/异常；**退出码就是门禁** |
| `probes/*.js` | 15 个场景脚本：phase0-3、wave1、e2e-boss/win、perf、stress、audio、camera、fx、gate-edge… |
| `contact_sheet.py` | 全素材总览图（人工验收） |

## 8. 测试（`tests/`）

91 条纯逻辑单测，跑 `node --test "tests/**/*.test.mjs"`：

- `world/actor/attacks/ai/level/input/projectiles` — 战斗与关卡逻辑
- `animation/hit-rhythm` — 剪辑选择、连打节奏
- `hit-and-corpse` — 死亡冻结最后一帧、连段音高/重音
- `restyle-batch` — 批量守卫 + 续跑校验（用假 ComfyUI，无 GPU）
- `scale/pixelfont` — 像素缩放与点阵字体

## 9. 运行时（`src/`，不是工具但与工具强耦合）

- `src/core/*.js` — 纯逻辑，可在 node 里跑，不碰 DOM（这是 91 条单测成立的前提）
- `src/render/*.js` — 浏览器层：精灵绘制、点阵字、整数倍缩放、WebAudio

## 10. 本会话用到的外部工具（不属于项目仓库）

| 工具 | 用途 |
|---|---|
| ComfyUI MCP | 健康检查、模型清单、节点管理（`--enable-manager` 修复）、workflow 校验 |
| Blender MCP | 场景/对象检查、导出校验、预览 |
| `bl` CLI（阿里云百炼） | 人声 TTS（CosyVoice / Qwen-TTS） |

---

## 依赖关系（谁读谁的产物）

```
.blend ──render_clips──▶ PNG 帧 ──restyle──▶ tmp/restyle-* ──compose_final──▶ tmp/final-*
                                                                    │              │
                                                     palette.png ◀──┘              │
                                                                                   ▼
                                                     frame_diff / pivot_drift / walk_gate
                                                                                   │
                                                                                   ▼
                                                        pack_sprites ──▶ assets/sprites/*.png/.json
                                                                                   │
                                                                                   ▼
                                                                    src/render/sprites.js（游戏）
```
