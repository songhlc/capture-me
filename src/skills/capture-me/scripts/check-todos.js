#!/usr/bin/env node
/**
 * check-todos.js — 检查逾期待办
 * 每日晚运行，发送逾期提醒
 */

const path = require('path');
const { execSync } = require('child_process');
const { getTodos } = require('../db');

function checkOverdue() {
  const todos = getTodos(false); // 只获取未完成的
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const overdue = todos.filter(t => t.todo_due && t.todo_due < today);

  if (overdue.length === 0) {
    console.log('✓ 无逾期待办');
    return;
  }

  console.log(`⚠️ 发现 ${overdue.length} 条逾期待办：`);

  for (const t of overdue) {
    const dueDate = new Date(t.todo_due).toLocaleDateString('zh-CN');
    console.log(`  ⏰ [逾期] ${t.raw_text.slice(0, 50)}...`);
    console.log(`      截止日期: ${dueDate}`);
    console.log(`      记录时间: ${t.date}`);
    console.log('');
  }

  // 可以发送通知（可选）
  if (process.platform === 'darwin') {
    try {
      const title = `⚠️ ${overdue.length} 条逾期待办`;
      const body = overdue.slice(0, 3).map(t => t.raw_text.slice(0, 30)).join('\n');
      execSync(`osascript -e 'display notification "${body}" with title "${title}"'`, { timeout: 5000 });
    } catch (e) {
      // 通知失败不影响主流程
    }
  }
}

// CLI
if (require.main === module) {
  checkOverdue();
}

module.exports = { checkOverdue };
