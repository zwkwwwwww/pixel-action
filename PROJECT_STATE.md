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

- 当前 Phase：**Phase 1 完成（动作纯逻辑 + 色块版可打穿），Phase 2 由子代理并行推进 Blender 主角管线**
- 当前分支：`main`
- 运行状态：**正常**
- 最近测试结果：`node --test "tests/**/*.test.mjs"` → **54 pass / 0 fail**
  （缩放 7 + 输入 5 + 攻击 7 + 输入缓冲 5 + 世界 13 + AI 7 + 关卡 9 + 自动通关 1）
- 最近验证证据：
  - `art-source/evidence/phase1.png`（色块版战斗）
  - CDP 探针 `tools/probes/phase1.js` 实测：走路 → **刷出 2 只 grunt、闸门 400**；
    真实按 J **9 次命中 / 造成 80 伤害 / 双杀**；清完 **gateX 变 null**；按 K 得 **invuln:15**；
    内部 `480×270`；`consoleErrors:[] exceptions:[]`
  - `tests/playthrough.test.mjs`：无作弊自动玩家 **打通 3 波 + 击败 Boss**（全程掉血但未死）

## 运行方式（已实测）

| 用途 | 命令 |
| --- | --- |
| 启动静态服务器 | `python -m http.server 9500 --bind 127.0.0.1`（项目根目录；日志必须重定向到文件，否则管道写满会卡死请求） |
| 打开游戏 | `http://127.0.0.1:9500/` |
| 单测 | `node --test "tests/**/*.test.mjs"` |
| 浏览器取证 | `node tools/browser-probe.mjs --url http://127.0.0.1:9500/ --wait 1800 --shot art-source/evidence/x.png --eval-file tools/probes/phase0.js` |

## 环境事实（已实测）

- Blender 5.2.1 LTS @ `E:/Program Files/Blender Foundation/Blender 5.2/blender.exe`（dsh-blender 工具可用）
- ComfyUI @ `http://127.0.0.1:8888`（本机 `E:/Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI`，共享模型池
  `E:/Comfy-Desktop/ComfyUI-Shared/models`；已补 `extra_model_paths.yaml` 指向共享池；日志在 `../pixel-action-logs/`）
- 可用模型：`z_image_turbo-Q5_K_M.gguf`(5.2G) + `Qwen3-4B-Q4_K_M.gguf`(2.3G) + `ae.safetensors`；
  ControlNet 补丁 `Z-Image-Turbo-Fun-Controlnet-Union-2.1-lite-2602-8steps` / `...-Tile-2.1-lite-...`；
  另有 `animagine-xl-4.0` / `juggernaut-xl-v9`（SDXL 回退）、ACE-Step 音频三件套
- GPU RTX 5060 Laptop 8GB；Node v24.21.0；Python 3.13.14
- 已知坑：DSH 内置浏览器缺 Electron 不可用 → 用 CDP 探针脚本；端口 8080/8099/8123 被 Windows 保留 → 用 9500；
  `node --test tests/` 要把目录当模块 → 必须写 glob

## 代码地图（当前真实存在的文件）

- `PROJECT_STATE.md` — 本文件
- （待 Phase 0 建立）

## 遗留 Bug 清单

- [ ] 暂无

## 下一步计划

1. 等待人类批准 Total Plan。
2. 批准后进入 Phase 0：搭 `index.html` + `src/main.js` + 480×270 画布 + 占位方块左右跑动，跑通单测与截图取证。
