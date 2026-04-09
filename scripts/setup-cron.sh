#!/bin/bash
# setup-cron.sh — 设置 capture-you 定时任务
# 用法: ./scripts/setup-cron.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SKILL_DIR="$PROJECT_ROOT/.claude/skills/capture-you"

echo "⏰ 设置 capture-you 定时任务..."

# 检查 skill 目录是否存在
if [ ! -d "$SKILL_DIR" ]; then
  echo "❌ Skill 目录不存在: $SKILL_DIR"
  echo "   请先运行: ./scripts/sync-skills.sh"
  exit 1
fi

# 获取当前 crontab
CURRENT_CRONTAB=$(crontab -l 2>/dev/null || echo "")

# 定义定时任务
TASKS=(
  "# Capture-You 每周日早 9 点周报"
  "0 9 * * 0 cd $SKILL_DIR && node review.js week >> ~/.capture-you/logs/review-week.log 2>&1"
  ""
  "# Capture-You 每月最后几天晚 6 点评判生成"
  "0 18 28-31 * * cd $SKILL_DIR && node review.js month >> ~/.capture-you/logs/review-month.log 2>&1"
  ""
  "# Capture-You 每日晚 9 点待办过期检查"
  "0 21 * * * cd $SKILL_DIR && node scripts/check-todos.js >> ~/.capture-you/logs/todo-check.log 2>&1"
  ""
  "# Capture-You 每日晚 10 点性格画像更新"
  "0 22 * * * cd $SKILL_DIR && node profile.js >> ~/.capture-you/logs/profile.log 2>&1"
  ""
  "# Capture-You 同步源文件（每小时）"
  "0 * * * * cd $PROJECT_ROOT && ./scripts/sync-skills.sh capture-you"
)

# 创建日志目录
mkdir -p ~/.capture-you/logs

# 移除旧的 capture-you cron 条目
NEW_CRONTAB=$(echo "$CURRENT_CRONTAB" | grep -v "Capture-You" | grep -v "capture-you" | grep -v "sync-skills.sh")

# 添加新的条目
for task in "${TASKS[@]}"; do
  NEW_CRONTAB="$NEW_CRONTAB
$task"
done

# 应用新的 crontab
echo "$NEW_CRONTAB" | crontab -

echo "✅ 定时任务已设置:"
echo ""
crontab -l | grep -A1 "Capture-You" || echo "   (使用 grep 过滤)"
echo ""
echo "📝 当前定时任务:"
crontab -l 2>/dev/null | head -20
