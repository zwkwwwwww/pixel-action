# 美术管线：Blender × ComfyUI

> 一句话：**Blender 决定「是什么、怎么动」，ComfyUI 决定「像素细节长什么样」，Python 负责把两者钉在同一张像素网格上。**

## 为什么必须分工

| 只用一个工具 | 问题 |
| --- | --- |
| 只用 ComfyUI | 逐帧生成动作不连贯，腿会漂移、武器会变形，做不了动作游戏 |
| 只用 Blender | 低模渲染缩小后是「色块人」，没有像素画的手绘质感与光影细节 |
| 两者结合 | Blender 提供**结构锁**（轮廓/姿势/遮挡），ComfyUI 只补材质与光影 |

## 流程（每个角色一条命令）

```
# 0) 一次性：全局 48 色调色板（跨角色唯一真源，改它要重新构建所有 sprite）
bash tools/build-palette.sh                → art-source/palette.{png,json}

art-source/blender/<name>.blend            # 低模 + 骨骼 + 9 组 action
        │  blender -b ... -P tools/blender/render_clips.py
        ▼
art-source/blender/<name>/<clip>/*.png     # 384×384 RGBA，正交 3/4 侧视，透明底
        │  node tools/comfy/restyle.mjs     # Z-Image-Turbo + Fun-ControlNet(Union)
        ▼
tmp/restyle-<name>/<clip>/*.png            # 384×384 RGB（结构不变，补细节）
        │  python tools/compose_final.py    # 固定裁剪框 + 预乘 BOX 下采样 + 全局调色板 + 贴回 alpha
        ▼
tmp/final-<name>/<clip>/*.png              # 96×96 硬像素帧（Boss 160×160）+ _compose.json
        │  frame_diff（剪影交集）→ pivot_drift（变换唯一）→ pack_sprites
        ▼
assets/sprites/<name>.png + .json          # 游戏直接加载
```

一条命令：`bash tools/build-sprites.sh hero`、`bash tools/build-enemy-sprites.sh`。

## 关键参数与理由

| 参数 | 值 | 为什么 |
| --- | --- | --- |
| ControlNet | Fun-ControlNet-Union 2.1-lite (8 steps) | 结构锁：只允许改材质，不允许重画轮廓 |
| strength | 0.9 | 太低会重画姿势，太高会完全忽略提示词 |
| denoise | 0.5 | 0.5 时 Z-Image 还能补细节，0.7 开始帧间漂移 |
| 采样 | 8 步 / cfg 1 / euler+simple | turbo 蒸馏模型的唯一正确用法（cfg 1 时负向词无效） |
| 种子 | 同一角色固定 | 噪声相关 → 相邻帧风格一致 |
| 缩放 | 站姿参考帧定死 | 逐帧按包围盒缩放会让倒地帧突然放大 3 倍（实测撑爆 cell） |
| 降采样 | 预乘 alpha 的 BOX（面积平均） | 契约禁止插值；预乘可避免轮廓外的 AI 铺底灰渗进边缘（实测旧版外圈色差 22.3、4–5% 环像素被污染） |
| 调色板 | 全局 48 色（`art-source/palette.png`） | 逐帧独立量化会让 hero 一张表 1237 色、5 张表只共有 4 色 → 换装/白闪/Boss 变色做不了 |
| 裁剪框 | 全角色固定（以站姿参考帧根节点为中心） | 逐帧 bbox 居中会把挥剑帧整体推离锚点：attack2 实测 17.5px 横移，与固定碰撞盒错位 |
| alpha | 取 Blender 原始渲染 | AI 输出的边缘不可信，轮廓必须由 3D 渲染保证 |

## 质量闸门

1. **帧间一致性** `tools/frame_diff.py`：只在**剪影交集**上比较相邻帧（去运动边界），
   循环剪辑（idle/walk）额外判定首尾缝合。默认阈值 0.25 / 循环 0.20。
   旧实现在整张 cell 上取均值，角色只占 ~8%，实测 0.005–0.036 而阈值 0.22 —— 数学上不可达，
   等于没有闸门。新口径实测正常素材 0.043–0.228；把任一帧反色会立刻变红（阴性对照已验证）。
2. **帧数完整性** `pack_sprites.py`：缺帧/帧号不连续直接报错，不产半成品。
3. **cell 尺寸**：缩放后宽度超过 cell 立刻报错（不会静默裁掉武器）。
4. **pivot 刚性** `tools/pivot_drift.py`：同一剪辑内后处理变换 `(box, scale, paste)` 必须唯一
   （从 compose 产出的 `_compose.json` 读）。旧版 attack2 腿轴极差 17.5px，修复后 0.5px。
5. **目视**：contact sheet + 游戏内截图，人眼判断剪影可读性。

三道数字闸门都接在 `build-sprites.sh` / `build-enemy-sprites.sh` 里，任一失败即中断（不再 `|| echo`）。

## 动画加帧（v2）

原始动作是 4~6 帧的稀疏 pose（一帧一个姿势），60fps 下会明显一顿一顿。
`tools/blender/build_hero.py` 与 `tools/blender/enemies/build_enemies.py` 现在会在相邻 pose 之间做
**线性重采样**（循环剪辑用环绕插值 `u = i*n/target`，非循环用 `u = i*(n-1)/(target-1)` 保证首尾姿势不变），
fps 按 `round(fps * newN/oldN)` 抬高 —— 动作总时长不变，采样密度翻倍。

| 角色 | 帧数变化 |
| --- | --- |
| hero | 41 → 66（idle 4→8, walk 6→12, attack1/2 4→6, attack3 5→7, dodge 4→6, hurt 2→3, death 6→9, special 6→9） |
| grunt/brute/ranger/boss | 41 → 54（只加 idle/walk/attack1/hurt，其余剪辑敌人不用，省重塑时间） |

加帧只重跑「帧数变过」的剪辑（`tools/comfy/restyle-denser.sh` 先删对应目录再增量重塑）。

## 背景与音频

- 背景：`node tools/comfy/backgrounds.mjs` → Z-Image-Turbo 1280×720 → 960×270、48 色量化。
- **短音效：DSP 合成** `python tools/sfx-synth.py`。
  为什么不用 ACE-Step 生成音效：它是音乐模型，输出天然带音高/调性/混响；实测旧版 `sfx_hit` 的起音时间是
  666ms、`sfx_death` 峰值只有 0.011（几乎听不见）。动作游戏需要 80~250ms、attack < 5ms、干声、频段明确的声音，
  用噪声整形 + 扫频 + 指数衰减包络合成，完全可复现且零生成耗时。
- **普攻打空 = 静音**（按需求取消了挥空/破空声）。命中时只有撞击音；
  必杀是独立能量招式，保留自己的音效，在判定帧触发一次。
- **命中音的"击打感"配方**（`sfx_hit`，170ms）：
  1. 低频冲击：210→46Hz **指数**扫频（不是线性），45ms 衰减，另加 420→92Hz 二次谐波让笔记本喇叭也听得见；
  2. 宽带裂响：噪声 HP 420Hz，**0.4ms** 起音、9ms 衰减；
  3. 金属尖：2380/3560/5010Hz 三个非谐分音，只留 22ms（旧版 160ms 余响会糊住瞬态）；
  4. 末端 tanh 软削波：波峰因数 8.0 → 4.2，同峰值下 RMS 提高 2.2 倍。
     另外**淡入从 2ms 改成 0.2ms**——旧版正是这 2ms 把瞬态峰值从 0.89 削到 0.77。
  游戏侧：命中音量 0.55→0.9、每次 playbackRate 0.94~1.06 随机、总线加 DynamicsCompressor（-16dB/3:1），
  BGM 从 0.45 降到 0.32 给打击声让出空间。
- **人声（受击/死亡）：百炼 TTS**。`tools/voice-fx.py` 做后期。
  为什么换：formant 合成能做出元音，但**没有真人声带细节**（气声、破音、共振峰滑动），
  短促痛呼听起来像电子音。现在用专用语音模型生成，质量高一档：
  - 玩家受击「呃」：Qwen-Audio-TTS（`--instruction` 控制"短促痛苦闷哼"），女声
  - 敌人死亡：**当前版本没有人声**（按需求去掉），只保留击杀瞬间的撞击音；
    `tools/voice-fx.py --die` 仍保留生成能力，需要时再开
  - 后期：裁首尾静音 → 受击截到 280ms → 受击在 t=0 补一记低频冲击
    （TTS 起音有 50ms 渐强，不补瞬态会"软"）→ 归一化
  - 原始 TTS 产物在 `tmp/voice/`（不入库），生成命令见 `tools/voice-fx.py` 头部注释
- BGM：`node tools/comfy/audio-batch.mjs` → ACE-Step 1.5 turbo（8 步 / cfg 1）→ mp3。
- 清单：`python tools/audio-manifest.py`；体检：`python tools/audio-analyze.py`（起音/质心/时长对比）。

## 已知限制

- 腿部只有刚性骨（无膝关节），走/跑靠摆胯 + 手臂；死亡是整体倒地而非 ragdoll。
- 敌人为控制时间只重塑了 idle/walk/attack1/hurt/death 5 个剪辑，attack2/3 在播放时回退到 attack1。
- 面部在 56px 下只有色块级细节（这是像素规格决定的，不是渲染缺陷）。
