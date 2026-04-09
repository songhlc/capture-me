#!/bin/bash
# install.sh — 环境检查与依赖安装
# 用法: ./scripts/install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔍 检查环境..."
echo ""

# 检查 Node.js
check_node() {
  if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装"
    echo "   请从 https://nodejs.org/ 安装 Node.js 18+"
    exit 1
  fi

  NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 版本过低: $(node -v)"
    echo "   需要 Node.js 18.0.0 或更高版本"
    exit 1
  fi

  echo "✅ Node.js: $(node -v)"
}

# 检查 npm
check_npm() {
  if ! command -v npm &> /dev/null; then
    echo "❌ npm 未安装"
    exit 1
  fi

  NPM_VERSION=$(npm -v)
  echo "✅ npm: $NPM_VERSION"
}

# 检查并创建目录
check_dirs() {
  echo ""
  echo "📁 检查目录..."

  # skill 目录
  mkdir -p "$SKILL_DIR/sqlite"
  echo "✅ $SKILL_DIR/sqlite"

  # 日志目录
  mkdir -p ~/.capture-you/logs
  echo "✅ ~/.capture-you/logs"
}

# 安装 npm 依赖
install_deps() {
  echo ""
  echo "📦 安装 npm 依赖..."

  cd "$SKILL_DIR"

  if [ ! -f "package.json" ]; then
    echo "❌ package.json 不存在"
    exit 1
  fi

  npm install

  echo "✅ npm 依赖安装完成"
}

# 初始化数据库
init_database() {
  echo ""
  echo "🗄️ 初始化数据库..."

  cd "$SKILL_DIR"

  if [ -f "db.js" ]; then
    node db.js init
    echo "✅ 数据库初始化完成"
  else
    echo "⚠️ db.js 不存在，跳过数据库初始化"
  fi
}

# 运行测试
run_tests() {
  echo ""
  echo "🧪 运行测试..."

  cd "$SKILL_DIR"

  if npm test 2>&1 | tee /tmp/capture-you-test-output.txt; then
    echo ""
    echo "✅ 所有测试通过!"
  else
    echo ""
    echo "⚠️ 部分测试失败，请检查输出"
  fi
}

# 主流程
main() {
  echo "═══════════════════════════════════════"
  echo "  Capture-You 环境安装"
  echo "═══════════════════════════════════════"
  echo ""

  check_node
  check_npm
  check_dirs
  install_deps
  init_database

  echo ""
  echo "═══════════════════════════════════════"
  echo "  安装完成!"
  echo "═══════════════════════════════════════"
  echo ""
  echo "下一步:"
  echo "  npm test          # 运行测试"
  echo "  node capture.js   # 记录内容"
  echo ""
}

main
