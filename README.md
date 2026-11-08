# 锈月回响 / Echoes of the Rusted Moon

一个用 **Blender + ComfyUI** 产出的 **横版 2.5D 像素动作游戏**垂直切片（**三关**）。

> THE MOON RUSTED THREE NIGHTS AGO. WHAT FELL FROM IT STILL BURNS.

- 内部渲染 **480 × 270**，整数倍最近邻放大（像素边缘绝对不糊）
- 原生 **HTML5 Canvas + ES Module**，零框架、零运行时依赖
- 战斗精灵表：Blender 低模 + 骨骼动画 → 正交渲染 → **ComfyUI（Z-Image-Turbo + Fun-ControlNet）像素化重塑** → 三道闸门 → 打包
- 过场演出：**ComfyUI 文生图**产出非像素插画（6 张），视觉小说式逐字机
- 场景背景：ComfyUI 出图 → 48 色量化
- 音频：音效 **DSP 合成**（非谐泛音 + 扫频 + 瞬态包络），BGM 由 **ACE-Step 1.5** 生成后做响度归一并限幅 —— 无任何外部版权素材

## 玩

```bash
node tools/dev-server.mjs 9500
# 浏览器打开 http://127.0.0.1:9500/
```

> 必须用 `tools/dev-server.mjs`（发 `no-store`）。普通的 `python -m http.server` 会让浏览器缓存 ES module，改代码看不到效果。

### 操作

| 操作 | 键位 |
| --- | --- |
| 走位（X 前进 / Y 纵深四车道） | `W A S D` / 方向键 |
| 普攻三连（按住蓄力变为重斩） | `J` |
| 翻滚（带无敌帧，可穿过敌人） | `K` |
| 必杀（消耗能量） | `L` |
| 投掷飞刀 | `U` |
| 跳跃 / 二段跳 | `Space` |
| 暂停（可 `R` 重开 / `M` 静音） | `Esc` |
| 静音 | `M` |

### 内容

- **三关**：RUSTED STREET → MOONLIT FOUNDRY → CLOCK TOWER，每关 3 波杂兵 + 1 个 Boss
- **五种敌人**：剑兵、重装兵、弓手（远程投射物）、盾兵（正面格挡 -80%，重斩可破防）、飞行敌人（地面攻击打不到，需跳跃或飞刀）
- **三个 Boss**：锈月骑士（多阶段）、召唤者（远程法球 + 召唤援军）、狂战士（狂暴冲锋）
- **三档难度**：EASY / NORMAL / HARD，只缩放敌人伤害，不影响玩家输出
- 连击评级（D/C/B/A/S）+ 剩余时间条、打击停顿分级、背刺加成、清波奖励、地面补给箱

## 验证

```bash
node --test "tests/**/*.test.mjs"       # 207 条纯逻辑测试，全部通过
```

测试覆盖战斗判定、Boss 阶段、敌人机制、机动性、难度、拾取、音频清单与**频谱**（自带 FFT），
以及一条不靠作弊的自动通关。

## 美术管线

```
tools/blender/            低模建模 + 骨骼动画 + 正交渲染（384×384）
      ↓
tools/comfy/restyle.mjs   ComfyUI img2img 像素化重塑（Z-Image-Turbo GGUF + ControlNet）
      ↓
tools/compose_final.py    固定裁切框 + 预乘 + 48 色调色板
      ↓
tools/frame_diff.py       帧间差闸门（动画不能跳）
tools/pivot_drift.py      轴心漂移闸门（角色不能抖）
tools/walk_gate.py        走路闸门
      ↓
tools/pack_sprites.py     打包成 {image, cell, anchor, clips, version} 契约
```

三道闸门不过就不许打包 —— 这是"AI 生成的图直接进游戏"最常见的翻车点。

另有独立管线：

| 工具 | 用途 |
| --- | --- |
| `tools/comfy/story-art.mjs` | 过场插画（文生图，明确排除 pixel art）+ 椭圆软蒙版立绘 |
| `tools/comfy/audio-batch.mjs` | ACE-Step 生成 BGM |
| `tools/sfx-synth.py` | DSP 合成音效 |
| `tools/audio-polish.py` | BGM 响度归一化 + 软限幅（生成式音频必须做，否则削波刺耳） |
| `tools/audio-spectrum.py` | 音效频谱体检 |
| `tools/browser-probe.mjs` | CDP 真实键鼠事件 + 截图取证 |

## 目录

```
index.html               入口
src/main.js              接线层：主循环 / 输入 / HUD
src/core/                纯逻辑层（可在 node 单测，不碰 DOM/Canvas）
src/render/              渲染层（精灵、像素字体、音频）
assets/                  精灵表、背景、过场插画、音频
tools/                   Blender / ComfyUI / 音频 / 校验工具
tests/                   node --test
art-source/              管线中间产物与验收截图
docs/                    管线文档与资产契约
```

## 实测数据

| 项 | 结果 |
| --- | --- |
| 单测 | **207 pass / 0 fail** |
| 素材加载 | 10 张精灵表 + 6 张过场插画 + 4 张背景，`missing: []` |
| 性能 | 常规 60fps（逻辑 0.05ms / 绘制 0.40ms）；240 粒子 + 300 飘字仍 60.4fps |
| 帧间一致性 | 所有剪辑最大像素差 0.055（阈值 0.22） |
| 音频 | 13/13 解码，BGM peak 0.818/0.834 零削波，音效频谱质心 1188–4920Hz |

证据截图在 `art-source/evidence/`。

## 已知限制

- 触屏 / 手柄未适配（原定非验收项）
- 无中途存档（只有通关记录存 localStorage）
- 无法自定义键位

## 素材声明

所有美术与音频均由本项目自己的管线生成（Blender 建模、ComfyUI 推理、DSP 合成），
不包含任何第三方版权素材。