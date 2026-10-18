# 锈月回响 / Echoes of the Rusted Moon

一个用 **Blender + ComfyUI** 产出的 **横版 2.5D 像素动作游戏**垂直切片。

- 内部渲染 **480 × 270**，整数倍最近邻放大（像素边缘绝对不糊）
- 原生 **HTML5 Canvas + ES Module**，零框架零依赖
- 主角 / 敌人 / Boss 美术：Blender 低模 + 骨骼动画 → 正交渲染 → **ComfyUI（Z-Image-Turbo + Fun-ControlNet）像素化重塑** → 精灵表
- 场景 / 标题背景：ComfyUI 出图 → 48 色量化
- 音效：**DSP 合成**（噪声整形 + 扫频 + 瞬态包络，80~900ms），BGM 仍由 ComfyUI **ACE-Step 1.5** 生成，无任何外部版权素材
- 角色动画 **12 帧走路 / 8 帧待机**（原始 6/4 帧，构建时做关键帧重采样），60fps 下动作不再一顿一顿
- 敌方弓手有独立**投射物系统**：会走位对齐车道、拉弓放箭，箭可被闪避无敌帧躲掉
- 镜头是**带朝向前瞻的阻尼跟随**，不再硬跟玩家

## 怎么玩

```bash
python -m http.server 9500 --bind 127.0.0.1     # 在本目录启动
# 浏览器打开 http://127.0.0.1:9500/ ，标题画面按 Enter
```

| 操作 | 键位 |
| --- | --- |
| 走位（X 前进 / Y 纵深） | `W A S D` / 方向键 |
| 普攻三连 | `J`（连按） |
| 闪避（带无敌帧） | `K` |
| 必杀（能量满） | `L` |
| 静音 | `M` |
| 重开 | `R` |

目标：清掉 3 波敌人 → 击败 Boss「锈月骑士」→ STAGE CLEAR。HP 归零即失败。

## 验证

```bash
node --test "tests/**/*.test.mjs"        # 72 条纯逻辑单测（含无作弊自动通关）
```

浏览器取证（CDP，真实键鼠事件 + 截图）见 `tools/browser-probe.mjs` 与 `tools/probes/`。

实测数据（本机 RTX 5060 Laptop 8GB）：

| 项 | 结果 |
| --- | --- |
| 单测 | 72 pass / 0 fail |
| 素材加载 | `loaded:5 / failed:0`，console error 0 |
| 清第 1 波（真实按键） | `segmentIndex:1`，2 杀，hp 112 |
| Boss | 出场 hp 420、体型 20；18 次攻击造成 136 伤害；击杀后 `won:true` |
| 音频 | `ctxState:running`、8/8 解码、BGM + 4 类音效实际播出 |
| 性能 | 常规 60fps（逻辑 0.05ms / 绘制 0.40ms）；240 粒子 + 300 飘字仍 60.4fps |
| 帧间一致性 | 所有剪辑最大像素差 0.055（阈值 0.22） |
| 动画帧数 | hero 41 → **66 帧**；敌人/Boss 各 41 → 54 帧（idle 8 / walk 12 / attack1 6…） |
| 音效 | 起音时间 swing 375ms→**4.4ms**、hit 666ms→**1.0ms**；时长 1.0s→0.17s/0.24s |
| 弓手 | 真实跑动中射出箭并命中：`shotEvents:2`、玩家 hp 111→95、播放 `sfx_bow` |
| 镜头 | 阻尼跟随，150ms 内最大位移 0.08px（无跳变） |

证据截图在 `art-source/evidence/`：`title.png`、`shot-combat.png`、`e2e-boss.png`、`e2e-win.png`、`contact-sheet.png`。

## 美术管线（一条命令）

```bash
bash tools/build-sprites.sh hero            # Blender 帧 → ComfyUI 重塑 → 硬像素 → 精灵表
bash tools/build-enemy-sprites.sh           # grunt / brute / ranger / boss
node tools/comfy/backgrounds.mjs            # 场景背景
node tools/comfy/audio-batch.mjs            # 音效 + BGM
```

细节与参数理由见 [`docs/ART_PIPELINE.md`](docs/ART_PIPELINE.md)，尺寸契约见 [`docs/art-contract.md`](docs/art-contract.md)。

## 目录

```
index.html              入口
src/main.js             场景/输入/循环/绘制/音频事件
src/core/               纯逻辑（可在 node 单测，不碰 DOM）
  world.js              战斗世界（命中结算 / 命中停顿 / 事件流）
  actor.js              角色状态机与物理（挑空 / 倒地 / 无敌帧）
  attacks.js            攻击数据表与命中盒几何
  ai.js                 三种敌人 + Boss AI
  level.js              波次 / 闸门 / 胜负
  animation.js          状态 → 剪辑 → 帧号
  effects.js            飘字 / 粒子
  input.js              方向 + 输入缓冲
src/render/             渲染层（视口缩放 / 精灵 / 点阵字 / 音频）
tools/blender/          Blender 建模与渲染脚本（含 README）
tools/comfy/            ComfyUI 客户端、重塑、背景、音频
tools/*.py              像素化 / 合成 / 打包 / 一致性闸门 / 总览图
assets/                 游戏直接加载的成品（精灵表 / 背景 / 音频）
art-source/             Blender 工程源文件（.blend 入库，渲染帧不入库）
```

## 已知限制

- 单关垂直切片：3 波小怪 + 1 Boss，没有多关卡/养成/存档。
- 敌人为控制生成时间只重塑了 idle / walk / attack1 / hurt / death 五个剪辑，attack2/3 播放时回退 attack1。
- 触屏适配未做（桌面浏览器优先）。
- 背景与角色的透视比例是风格化处理的（背景偏大），已用暗化与程序化地面统一观感。
