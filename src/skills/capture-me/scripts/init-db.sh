#!/bin/bash
# init-db.sh — 初始化 capture-me 数据库

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
DB_DIR="$SKILL_DIR/sqlite"

echo "📦 初始化 capture-me 数据库..."

# 创建目录
mkdir -p "$DB_DIR"

# 初始化 SQLite 数据库
cd "$SKILL_DIR"
node db.js init

echo "✅ 初始化完成"
echo "   数据库位置: $DB_DIR/capture.db"
