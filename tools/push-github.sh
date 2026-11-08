#!/usr/bin/env bash
# 一键推到 GitHub：用 PAT 创建仓库并推送。
#
# 用法:
#   GITHUB_TOKEN=ghp_xxx GITHUB_USER=yourname ./tools/push-github.sh [repo名] [public|private]
#
# 设计要点：
#   - token 只通过环境变量传入，不落盘、不进 git 历史
#   - 推完把 remote 改写成不带 token 的 https 地址（避免 token 留在 .git/config）
#   - 幂等：仓库已存在就直接推，不报错
set -euo pipefail

REPO="${1:-pixel-action}"
VIS="${2:-public}"
BRANCH="$(git branch --show-current)"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "错误：需要 GITHUB_TOKEN 环境变量" >&2
  exit 1
fi

# 从 token 反查用户名（避免让用户再填一次）
if [[ -z "${GITHUB_USER:-}" ]]; then
  GITHUB_USER="$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/user | python -c 'import sys,json; print(json.load(sys.stdin).get("login",""))')"
fi
if [[ -z "$GITHUB_USER" ]]; then
  echo "错误：无法从 token 解析用户名，请显式传 GITHUB_USER" >&2
  exit 1
fi
echo "账号: $GITHUB_USER   仓库: $REPO   可见性: $VIS"

PRIVATE_FLAG=false
[[ "$VIS" == "private" ]] && PRIVATE_FLAG=true

# 1) 创建仓库（已存在则忽略 422）
CREATE=$(curl -s -w '\n%{http_code}' -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/repos \
  -d "{\"name\":\"$REPO\",\"private\":$PRIVATE_FLAG,\"description\":\"Echoes of the Rusted Moon - Blender + ComfyUI pixel action game\",\"auto_init\":false}")
CODE=$(echo "$CREATE" | tail -1)
if [[ "$CODE" == "201" ]]; then
  echo "✓ 已创建仓库 $GITHUB_USER/$REPO"
elif [[ "$CODE" == "422" ]]; then
  echo "· 仓库已存在，直接推送"
else
  echo "创建仓库失败 (HTTP $CODE)" >&2
  echo "$CREATE" | head -c 400 >&2
  exit 1
fi

# 2) 用带 token 的 URL 推送（只在这一次命令里出现，不写进 config）
git remote remove origin 2>/dev/null || true
PUSH_URL="https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO}.git"
git push "$PUSH_URL" "$BRANCH:main" --tags

# 3) remote 改成干净地址（token 不留在 .git/config）
git remote add origin "https://github.com/${GITHUB_USER}/${REPO}.git"

echo
echo "✓ 推送完成：https://github.com/${GITHUB_USER}/${REPO}"
echo "  请到 https://github.com/settings/tokens 撤销本次使用的 token"