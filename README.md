# 锈月回响 / Echoes of the Rusted Moon

一个用 **Blender + ComfyUI** 产出的 **横版 2.5D 像素动作游戏**垂直切片。

- 内部渲染 **480 × 270**，整数倍最近邻放大（像素边缘绝对不糊）
- 原生 **HTML5 Canvas + ES Module**，零框架零依赖
- 主角 / 敌人 / Boss 美术：Blender 低模 + 骨骼动画 → 正交渲染 → **ComfyUI（Z-Image-Turbo + Fun-ControlNet）像素化重塑** → 精灵表
- 场景 / 标题背景：ComfyUI 出图 → 48 色量化
- 音效 / BGM：ComfyUI **ACE-Step 1.5** 生成，无任何外部版权素材

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
