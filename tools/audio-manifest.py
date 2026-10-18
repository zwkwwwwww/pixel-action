#!/usr/bin/env python3
"""重建 assets/audio/manifest.json：按实际存在的文件登记（合成音效优先 wav，BGM/ACE 音效是 mp3）。

用法: python tools/audio-manifest.py
"""
from __future__ import annotations

import json
import wave
from pathlib import Path

AUDIO_DIR = Path("assets/audio")
# 顺序即加载顺序；游戏侧不依赖顺序
IDS = [
    "sfx_swing", "sfx_hit", "sfx_bow", "sfx_dodge", "sfx_death",
    "sfx_special", "sfx_victory", "bgm_battle", "bgm_boss",
]


def duration(path: Path) -> float | None:
    if path.suffix != ".wav":
        return None
    try:
        with wave.open(str(path), "rb") as w:
            return round(w.getnframes() / w.getframerate(), 3)
    except Exception:
        return None


def main() -> int:
    entries = []
    missing = []
    for audio_id in IDS:
        wav = AUDIO_DIR / f"{audio_id}.wav"
        mp3 = AUDIO_DIR / f"{audio_id}.mp3"
        # 合成音效同时有 wav/mp3 时用 wav（无损、浏览器解码无额外延迟）
        chosen = wav if wav.exists() else (mp3 if mp3.exists() else None)
        if chosen is None:
            missing.append(audio_id)
            continue
        item = {"id": audio_id, "file": chosen.name}
        d = duration(chosen)
        if d is not None:
            item["seconds"] = d
        entries.append(item)

    manifest = AUDIO_DIR / "manifest.json"
    manifest.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    print(json.dumps({
        "manifest": str(manifest),
        "entries": len(entries),
        "missing": missing,
        "files": [e["file"] for e in entries],
    }, ensure_ascii=False))
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
