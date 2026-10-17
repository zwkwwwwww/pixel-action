# 项目状态

> 本文件是项目的唯一可信记忆。AI 每轮内循环开始必读，每次 commit 前必更新。保持精简（150 行以内），过期信息及时清理。

## 战略规划（Total Plan）

- 游戏名：**《锈月回响 / Echoes of the Rusted Moon》**（暂定，人类可改名）
- 游戏类型：横版清版（belt-scroll）2.5D 动作游戏，单关垂直切片
- 核心机制：玩家操控女剑士在 X 轴前进、Y 轴 4 条纵深车道走位；普攻三连 + 挑空 + 闪避无敌帧 + 能量必杀，清掉 3 波敌人后击败 Boss 即通关；HP 归零失败。
- 目标平台：桌面浏览器（Chrome/Edge），内部渲染 480×270，整数倍放大；窄窗口触屏适配为非验收项。
- 技术栈 / 引擎：原生 HTML5 Canvas + ES Module，**零框架零依赖**；Blender 5.2 做低模与动画渲染；ComfyUI（Z-Image-Turbo）做像素化重塑与场景/UI/音频生成。
- 架构模式：纯逻辑层（`src/core/`，可在 node 单测，不碰 DOM/Canvas）/ 渲染层（`src/render/`）/ 接线层（`src/main.js`）；美术管线脚本在 `tools/blender/`、`tools/comfy/`。
- 美术管线（本项目的核心难点）：
  1. Blender 脚本建低模 + 骨骼，逐剪辑摆帧 → 正交相机 3/4 侧视渲染 PNG 帧序列（透明底，统一光照）
  2. Python 后处理：最近邻缩放、受限调色板量化、可选抖动 → 硬像素
  3. ComfyUI：Z-Image-Turbo（GGUF 8 步 / cfg 1）+ ControlNet Union 结构锁，按"整张精灵表一次性重塑"或"逐帧固定种子低 denoise"方式补细节，帧间像素差做一致性闸门
  4. 打包精灵表 + JSON 元数据（帧矩形/锚点/帧时长）→ `assets/`
- 运行方式：见下方「运行方式」。
- 里程碑：
  - Phase 0（引导期）：项目骨架 + 480×270 Canvas 渲染循环 + 占位方块可跑动 + 单测与 CDP 取证骨架
  - Phase 1：动作纯逻辑核心（状态机、输入缓冲、三连、闪避无敌帧、碰撞盒、受击/击飞、AI、波次关卡）与单测；色块版可打穿
  - Phase 2：Blender 主角管线（低模+骨骼+9 组动画+渲染+像素化+精灵表）接入游戏
  - Phase 3：ComfyUI 像素化重塑管线（结构锁 + 一致性闸门），主角/敌人全量过管线
  - Phase 4：3 种敌人 + Boss + 关卡场景与视差背景 + 战斗配平
  - Phase 5：特效/命中停顿/震屏/粒子 + ACE-Step 音效 BGM + HUD/结算 + 性能与端到端验收 + 合 main 并打 tag

## 当前状态

- 当前 Phase：**Phase 2/3 进行中**（hero 9 剪辑已接入；敌人 4 角色重塑中；音频生成中）
- 当前分支：`main`
- 运行状态：**正常**（标题画面 → Enter → 可玩）
- 最近测试结果：`node --test "tests/**/*.test.mjs"` → **72 pass / 0 fail**
- 最近验证证据：
  - 标题 `art-source/evidence/title.png`；战斗 `art-source/evidence/fx-combat.png`、`hero-sprite-combat.png`
  - hero 精灵表 `assets/sprites/hero.png`（9 剪辑 41 帧，96×96，固定缩放 0.2478）
  - 帧间一致性 `art-source/reports/frame-diff-hero.json`：9/9 剪辑通过（最大 0.046，阈值 0.22）
  - CDP 实测：`internal:480×270 / scale:3 / spriteDrawn>0 / damageDealt:80 / dodgeInvuln:15 / consoleErrors:[]`
  - 自动通关单测：无作弊 bot 打通 3 波 + Boss

## 运行方式（已实测）

| 用途 | 命令 |
| --- | --- |
| 启动静态服务器 | `python -m http.server 9500 --bind 127.0.0.1`（**必须把输出重定向到文件**，否则管道写满会卡死请求） |
| 打开游戏 | `http://127.0.0.1:9500/` → 标题画面按 **Enter** |
| 操作 | WASD 走位 / J 攻击（三连）/ K 闪避 / L 必杀 / M 静音 / R 重开 |
| 单测 | `node --test "tests/**/*.test.mjs"` |
| 重建 hero 精灵表（含 ComfyUI 重塑） | `bash tools/build-sprites.sh hero` |
| 重建敌人精灵表 | `bash tools/build-enemy-sprites.sh` |
| 背景重生成 | `node tools/comfy/backgrounds.mjs [--force]` |
| 音频重生成 | `node tools/comfy/audio-batch.mjs [--force]` |
| 帧间一致性 | `python tools/frame_diff.py --in tmp/final-hero --threshold 0.22` |
| 浏览器取证 | `node tools/browser-probe.mjs --url http://127.0.0.1:9500/ --wait 1800 --shot art-source/evidence/x.png --eval-file tools/probes/phase2.js` |
| 素材总览图 | `python tools/contact_sheet.py` |

## 代码地图（当前真实存在的文件）

- `index.html` — canvas#game + 内联图标
- `src/main.js` — 标题/战斗场景、输入、固定步长循环、相机、绘制、音频事件、取证接口 `globalThis.__game`
- `src/core/world.js` — 战斗世界（输入意图/命中结算/命中停顿/事件流）
- `src/core/actor.js` — 角色状态机与物理（挑空/倒地/起身/无敌帧）
- `src/core/attacks.js` — 攻击数据表（三连 + 必杀 + Boss slam）与命中盒几何
- `src/core/ai.js` — 三种敌人 + Boss 的 AI 配置与思考函数
- `src/core/level.js` — 3 波小怪 + Boss、闸门、胜负判定
- `src/core/input.js` — 方向映射 + 输入缓冲
- `src/core/animation.js` — 状态 → 剪辑 → 帧号映射（纯逻辑）
- `src/core/effects.js` — 飘字/粒子纯逻辑（硬上限 240）
- `src/render/scale.js` — 480×270 整数倍缩放视口
- `src/render/sprites.js` — 精灵表加载 + 朝向翻转 + 缺剪辑回退
- `src/render/pixelfont.js` — 5×7 点阵字体（HUD 无抗锯齿）
- `src/render/audio.js` — WebAudio 播放/BGM/静音/取证
- `src/data/*` — 由脚本生成的数据（暂无）
- `tools/blender/` — Blender 主角建模/渲染/验收脚本 + README
- `tools/blender/enemies/` — 敌人/Boss 建模/渲染脚本
- `tools/comfy/` — ComfyUI 客户端、像素化重塑、背景、音频
- `tools/pixelize.py` `compose_final.py` `pack_sprites.py` `frame_diff.py` `contact_sheet.py`
- `tools/build-sprites.sh` `build-enemy-sprites.sh` — 一条命令重建
- `assets/sprites/` `assets/bg/` `assets/audio/` — 游戏直接加载的成品
- `tests/*.test.mjs` — 72 条纯逻辑单测

## 环境事实（已实测）

- Blender 5.2.1 LTS @ `E:/Program Files/Blender Foundation/Blender 5.2/blender.exe`
- ComfyUI @ `http://127.0.0.1:8888`（本机安装 + 共享模型池 `E:/Comfy-Desktop/ComfyUI-Shared/models`；
  已补 `extra_model_paths.yaml`；日志 `../pixel-action-logs/`）
- 出图配方：`z_image_turbo-Q5_K_M.gguf` + `Qwen3-4B-Q4_K_M.gguf`(lumina2) + `ae.safetensors`，
  ControlNet `Z-Image-Turbo-Fun-Controlnet-Union-2.1-lite-2602-8steps`；8 步 / cfg 1 / euler+simple
- 音频配方：ACE-Step 1.5 turbo + qwen_0.6b/4b + ace_1.5_vae，8 步 / cfg 1
- GPU RTX 5060 Laptop 8GB；Node v24.21.0；Python 3.13.14
- 坑：DSH 内置浏览器缺 Electron → CDP 探针；Windows 保留端口 → 用 9500；`node --test tests/` 需 glob；
  静态服务器输出必须重定向；ComfyUI 逐帧重塑约 12~14s/帧

## 遗留 Bug 清单

- [ ] 敌人 attack2/attack3 未重塑，播放时回退 attack1（可接受，记录在案）
- [ ] 背景透视比角色大一号（风格化处理，已用暗化 + 程序化地面统一观感）

## 下一步计划

1. 等敌人重塑（88 帧）与音频跑完 → 跑 `tools/build-enemy-sprites.sh` → 接进游戏。
2. 端到端取证：三波 + Boss 的 CDP 截图；性能取证（满场粒子的帧内耗时）。
3. 更新 README / 交付说明，跑 contact sheet，合 main 打 tag `phase-slice`。
