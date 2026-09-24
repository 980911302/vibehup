#!/usr/bin/env bash
# 把 vibehub-mcp 技能装进本机各 AI 的用户级技能目录（Claude Code / Codex / 通用 agents）。
# 本机（有源码）：bash skills/install.sh
# 别的机器：     curl -fsSL http://<VibeHub 地址>:3210/skills/install.sh | VIBEHUB_URL=http://<VibeHub 地址>:3210 bash
# 改了 SKILL.md 之后重跑一次即可覆盖；旧文件先备份成 SKILL.md.bak。
set -euo pipefail

NAME=vibehub-mcp
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

if [ -n "${SRC_DIR}" ] && [ -f "${SRC_DIR}/${NAME}/SKILL.md" ]; then
  cp "${SRC_DIR}/${NAME}/SKILL.md" "$TMP"
elif [ -n "${VIBEHUB_URL:-}" ]; then
  curl -fsSL "${VIBEHUB_URL%/}/skills/${NAME}/SKILL.md" -o "$TMP"
else
  echo "找不到 ${NAME}/SKILL.md：在源码目录运行，或设置 VIBEHUB_URL" >&2
  exit 1
fi
head -1 "$TMP" | grep -qx -- '---' || { echo "下载到的不是技能文件（缺 frontmatter）" >&2; exit 1; }

for base in "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.agents/skills"; do
  dest="$base/$NAME"
  mkdir -p "$dest"
  if [ -f "$dest/SKILL.md" ] && ! cmp -s "$TMP" "$dest/SKILL.md"; then
    cp -p "$dest/SKILL.md" "$dest/SKILL.md.bak"
  fi
  cp "$TMP" "$dest/SKILL.md"
  chmod 644 "$dest/SKILL.md"
  echo "已安装 $dest/SKILL.md"
done
