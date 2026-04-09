#!/bin/bash
# sync-skills.sh — 同步 src/skills 到 .claude/skills
# 用法: ./scripts/sync-skills.sh [skill-name]
# 不带参数时同步所有 skills

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_ROOT/src/skills"
DEST_DIR="$PROJECT_ROOT/.claude/skills"

echo "📦 同步 skills..."
echo "   源: $SRC_DIR"
echo "   目标: $DEST_DIR"

if [ ! -d "$SRC_DIR" ]; then
  echo "❌ 源目录不存在: $SRC_DIR"
  exit 1
fi

if [ -n "$1" ]; then
  # 同步指定 skill
  SKILLS=("$1")
else
  # 同步所有 skills
  SKILLS=()
  for dir in "$SRC_DIR"/*/; do
    if [ -d "$dir" ]; then
      SKILLS+=("$(basename "$dir")")
    fi
  done
fi

for skill in "${SKILLS[@]}"; do
  echo ""
  echo "🔄 同步: $skill"

  src="$SRC_DIR/$skill"
  dest="$DEST_DIR/$skill"

  if [ ! -d "$src" ]; then
    echo "   ⚠️ 源不存在: $src"
    continue
  fi

  # 创建目标目录
  mkdir -p "$dest"

  # 复制文件（排除 node_modules、sqlite、memory、package-lock.json）
  # memory/ 是用户数据目录，在 .claude/skills/{skill}/memory/ 中，不应被覆盖
  rsync -av --exclude='node_modules' --exclude='sqlite' --exclude='memory' --exclude='package-lock.json' --exclude='coverage' "$src/" "$dest/"

  echo "   ✅ 已同步到 $dest"
done

echo ""
echo "✨ 完成!"
