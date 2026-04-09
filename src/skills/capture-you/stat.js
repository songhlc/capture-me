#!/usr/bin/env node
/**
 * stat.js — 记录统计
 * 查看记录数量、标签分布、待办统计等
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MEMORY_DIR = path.join(__dirname, '../../../memory');
const DB_PATH = path.join(MEMORY_DIR, '../.claude/skills/capture-you/sqlite/capture.db');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('数据库不存在');
    return null;
  }
  return new Database(DB_PATH, { readonly: true });
}

function getStats(db) {
  // 总记录数
  const totalNotes = db.prepare('SELECT COUNT(*) as count FROM notes').get().count;

  // 本周记录数
  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  const mondayStr = monday.toISOString().split('T')[0];
  const weekNotes = db.prepare('SELECT COUNT(*) as count FROM notes WHERE date >= ?').get(mondayStr).count;

  // 本月记录数
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthNotes = db.prepare('SELECT COUNT(*) as count FROM notes WHERE date >= ?').get(monthStart).count;

  // 待办统计
  const totalTodos = db.prepare('SELECT COUNT(*) as count FROM notes WHERE is_todo = 1').get().count;
  const pendingTodos = db.prepare('SELECT COUNT(*) as count FROM notes WHERE is_todo = 1 AND todo_done = 0').get().count;
  const completedTodos = db.prepare('SELECT COUNT(*) as count FROM notes WHERE is_todo = 1 AND todo_done = 1').get().count;

  // 逾期待办
  const today = now.toISOString().split('T')[0];
  const overdueTodos = db.prepare(`
    SELECT COUNT(*) as count FROM notes
    WHERE is_todo = 1 AND todo_done = 0 AND todo_due < ?
  `).get(today).count;

  // 分类分布
  const categories = db.prepare(`
    SELECT category, COUNT(*) as count FROM notes
    WHERE category IS NOT NULL
    GROUP BY category
    ORDER BY count DESC
  `).all();

  // 每日记录趋势（最近30天）
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dailyTrend = db.prepare(`
    SELECT date, COUNT(*) as count FROM notes
    WHERE date >= ?
    GROUP BY date
    ORDER BY date
  `).all(thirtyDaysAgo.toISOString().split('T')[0]);

  return {
    totalNotes,
    weekNotes,
    monthNotes,
    totalTodos,
    pendingTodos,
    completedTodos,
    overdueTodos,
    categories,
    dailyTrend,
  };
}

function formatStats(stats) {
  const today = new Date().toISOString().split('T')[0];

  const lines = [
    `📊 记录统计`,
    `═══════════════════════════════════════`,
    ``,
    `## 记录概览`,
    `  总记录数：${stats.totalNotes}`,
    `  本周新增：${stats.weekNotes}`,
    `  本月新增：${stats.monthNotes}`,
    ``,
    `## 待办状态`,
    `  总待办数：${stats.totalTodos}`,
    `  已完成：${stats.completedTodos}`,
    `  待处理：${stats.pendingTodos}`,
  ];

  if (stats.overdueTodos > 0) {
    lines.push(`  ⚠️ 逾期未完成：${stats.overdueTodos}`);
  }

  lines.push(``);
  lines.push(`## 分类分布`);

  if (stats.categories.length > 0) {
    const maxCount = Math.max(...stats.categories.map(c => c.count));
    for (const cat of stats.categories) {
      const bar = '█'.repeat(Math.round(cat.count / maxCount * 20));
      lines.push(`  ${String(cat.category || '未分类').padEnd(10)} ${bar} ${cat.count}`);
    }
  } else {
    lines.push(`  暂无数据`);
  }

  lines.push(``);
  lines.push(`## 最近30天趋势`);

  if (stats.dailyTrend.length > 0) {
    const total = stats.dailyTrend.reduce((sum, d) => sum + d.count, 0);
    const avg = (total / stats.dailyTrend.length).toFixed(1);
    lines.push(`  日均记录：${avg} 条`);
    lines.push(`  记录天数：${stats.dailyTrend.length} 天`);

    // 找出最高和最低
    const sorted = [...stats.dailyTrend].sort((a, b) => b.count - a.count);
    if (sorted.length > 0) {
      lines.push(`  最高：${sorted[0].date} (${sorted[0].count}条)`);
      if (sorted.length > 1) {
        lines.push(`  最低：${sorted[sorted.length - 1].date} (${sorted[sorted.length - 1].count}条)`);
      }
    }
  } else {
    lines.push(`  暂无数据`);
  }

  lines.push(``);
  lines.push(`─── 统计于 ${today} ───`);

  return lines.join('\n');
}

// CLI
if (require.main === module) {
  const db = ensureDb();
  if (!db) {
    console.log('📊 记录统计\n\n暂无数据，请先记录一些内容。');
    process.exit(0);
  }

  const stats = getStats(db);
  db.close();
  console.log(formatStats(stats));
}

module.exports = { getStats, formatStats };
