#!/usr/bin/env node
/**
 * review.js — 周报/月报生成
 * 读取本周/本月所有笔记，生成结构化报告
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MEMORY_DIR = path.join(__dirname, 'memory');
const DB_PATH = path.join(__dirname, 'sqlite', 'capture.db');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('数据库不存在，运行 `node db.js init` 初始化');
    return null;
  }
  return new Database(DB_PATH, { readonly: true });
}

function getWeekBounds() {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
}

function getMonthBounds() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return { start: firstDay, end: lastDay };
}

function getNotesByRange(db, startDate, endDate) {
  const stmt = db.prepare(`
    SELECT * FROM notes
    WHERE date >= ? AND date <= ?
    ORDER BY date ASC, time ASC
  `);
  return stmt.all(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]);
}

function analyzeNotes(notes) {
  const categories = {};
  const tags = {};
  const people = {};
  const todos = { total: 0, completed: 0, pending: 0 };
  const emotions = { positive: 0, negative: 0, neutral: 0 };
  const keyEvents = [];

  const EMOTION_POSITIVE = ['开心', '顺利', '完成', '成功', '高兴', '兴奋', '满意', '突破'];
  const EMOTION_NEGATIVE = ['焦虑', '压力', '担忧', '烦恼', '累', '疲惫', '没睡好'];

  for (const note of notes) {
    // 分类统计
    if (note.category) {
      categories[note.category] = (categories[note.category] || 0) + 1;
    }

    // 标签统计
    if (note.tags) {
      try {
        const noteTags = JSON.parse(note.tags);
        for (const tag of noteTags) {
          tags[tag] = (tags[tag] || 0) + 1;
        }
      } catch (e) {}
    }

    // 人物统计
    if (note.extracted_entities) {
      try {
        const entities = JSON.parse(note.extracted_entities);
        for (const person of entities.people || []) {
          people[person] = (people[person] || 0) + 1;
        }
      } catch (e) {}
    }

    // 待办统计
    if (note.is_todo) {
      todos.total++;
      if (note.todo_done) {
        todos.completed++;
      } else {
        todos.pending++;
      }
    }

    // 情绪分析
    const text = note.raw_text + ' ' + (note.ai_summary || '');
    let found = null;
    for (const kw of EMOTION_POSITIVE) {
      if (text.includes(kw)) { found = 'positive'; break; }
    }
    if (!found) {
      for (const kw of EMOTION_NEGATIVE) {
        if (text.includes(kw)) { found = 'negative'; break; }
      }
    }
    if (found) emotions[found]++;
    else emotions.neutral++;

    // 关键事件提取（AI 摘要不为空的记录）
    if (note.ai_summary && note.ai_summary.length > 5) {
      keyEvents.push({
        date: note.date,
        time: note.time,
        summary: note.ai_summary,
        category: note.category,
      });
    }
  }

  return { categories, tags, people, todos, emotions, keyEvents };
}

function formatWeekReport(notes, bounds) {
  const analysis = analyzeNotes(notes);
  const { monday, sunday } = bounds;

  const pad = d => String(d).padStart(2, '0');
  const mondayStr = `${monday.getFullYear()}-${pad(monday.getMonth()+1)}-${pad(monday.getDate())}`;
  const sundayStr = `${sunday.getFullYear()}-${pad(sunday.getMonth()+1)}-${pad(sunday.getDate())}`;

  const lines = [
    `📋 本周回顾 — ${mondayStr} ~ ${sundayStr}`,
    `═══════════════════════════════════════`,
    ``,
  ];

  if (notes.length === 0) {
    lines.push(`本周暂无记录`);
    return lines.join('\n');
  }

  // 关键事件
  if (analysis.keyEvents.length > 0) {
    lines.push(`## 📌 重要进展`);
    for (const evt of analysis.keyEvents.slice(0, 5)) {
      lines.push(`· [${evt.date}] ${evt.summary}`);
    }
    lines.push(``);
  }

  // 待办完成情况
  lines.push(`## ✅ 待办状态`);
  lines.push(`  本周新增待办：${analysis.todos.total}`);
  lines.push(`  已完成：${analysis.todos.completed}`);
  lines.push(`  待处理：${analysis.todos.pending}`);
  if (analysis.todos.total > 0) {
    const rate = Math.round(analysis.todos.completed / analysis.todos.total * 100);
    lines.push(`  完成率：${rate}%`);
  }
  lines.push(``);

  // 情绪分布
  lines.push(`## 💭 情绪状态`);
  const total = analysis.emotions.positive + analysis.emotions.neutral + analysis.emotions.negative;
  if (total > 0) {
    lines.push(`  🟢 积极：${analysis.emotions.positive}次`);
    lines.push(`  🟡 平缓：${analysis.emotions.neutral}次`);
    lines.push(`  🔴 低落：${analysis.emotions.negative}次`);
  } else {
    lines.push(`  暂无情绪数据`);
  }
  lines.push(``);

  // 分类分布
  if (Object.keys(analysis.categories).length > 0) {
    lines.push(`## 📂 记录分布`);
    const sortedCats = Object.entries(analysis.categories).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sortedCats) {
      lines.push(`  ${cat || '未分类'}：${count}条`);
    }
    lines.push(``);
  }

  // 高频联系人
  if (Object.keys(analysis.people).length > 0) {
    lines.push(`## 👥 高频互动`);
    const topPeople = Object.entries(analysis.people).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [name, count] of topPeople) {
      lines.push(`  ${name}：${count}次`);
    }
    lines.push(``);
  }

  // 统计
  lines.push(`───────────────────────────────────────`);
  lines.push(`📊 本周数据`);
  lines.push(`  记录总数：${notes.length}`);
  lines.push(`  记录天数：${new Set(notes.map(n => n.date)).size} 天`);

  return lines.join('\n');
}

function formatMonthReport(notes, bounds) {
  const analysis = analyzeNotes(notes);
  const { start, end } = bounds;

  const pad = d => String(d).padStart(2, '0');
  const startStr = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}`;
  const endStr = `${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}`;

  const lines = [
    `📊 本月回顾 — ${startStr} ~ ${endStr}`,
    `═══════════════════════════════════════`,
    ``,
  ];

  if (notes.length === 0) {
    lines.push(`本月暂无记录`);
    return lines.join('\n');
  }

  // 整体统计
  lines.push(`## 📈 整体统计`);
  lines.push(`  记录总数：${notes.length}`);
  lines.push(`  日均记录：${(notes.length / end.getDate()).toFixed(1)} 条`);

  const uniqueDays = new Set(notes.map(n => n.date)).size;
  lines.push(`  记录天数：${uniqueDays} 天（本月 ${end.getDate()} 天）`);
  lines.push(`  记录覆盖率：${Math.round(uniqueDays / end.getDate() * 100)}%`);
  lines.push(``);

  // 待办总结
  lines.push(`## ✅ 待办总结`);
  lines.push(`  本月待办总数：${analysis.todos.total}`);
  lines.push(`  已完成：${analysis.todos.completed}`);
  lines.push(`  完成率：${analysis.todos.total > 0 ? Math.round(analysis.todos.completed / analysis.todos.total * 100) : 0}%`);
  lines.push(``);

  // 情绪趋势
  lines.push(`## 💭 情绪趋势`);
  const total = analysis.emotions.positive + analysis.emotions.neutral + analysis.emotions.negative;
  if (total > 0) {
    lines.push(`  🟢 积极：${analysis.emotions.positive}次（${Math.round(analysis.emotions.positive / total * 100)}%）`);
    lines.push(`  🟡 平缓：${analysis.emotions.neutral}次（${Math.round(analysis.emotions.neutral / total * 100)}%）`);
    lines.push(`  🔴 低落：${analysis.emotions.negative}次（${Math.round(analysis.emotions.negative / total * 100)}%）`);
  } else {
    lines.push(`  暂无情绪数据`);
  }
  lines.push(``);

  // 分类分布
  if (Object.keys(analysis.categories).length > 0) {
    lines.push(`## 📂 分类分布`);
    const sortedCats = Object.entries(analysis.categories).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sortedCats) {
      const pct = Math.round(count / notes.length * 100);
      const bar = '█'.repeat(Math.round(pct / 5));
      lines.push(`  ${String(cat || '未分类').padEnd(8)} ${bar} ${count}条 (${pct}%)`);
    }
    lines.push(``);
  }

  // Top Tags
  if (Object.keys(analysis.tags).length > 0) {
    lines.push(`## 🏷️ 高频标签`);
    const sortedTags = Object.entries(analysis.tags).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [tag, count] of sortedTags) {
      lines.push(`  ${tag}：${count}次`);
    }
    lines.push(``);
  }

  // 关键事件回顾
  if (analysis.keyEvents.length > 0) {
    lines.push(`## 🌟 本月亮点`);
    for (const evt of analysis.keyEvents.slice(0, 3)) {
      lines.push(`· [${evt.date}] ${evt.summary}`);
    }
    lines.push(``);
  }

  lines.push(`───────────────────────────────────────`);
  lines.push(`📅 月度目标建议`);
  lines.push(`· 记录覆盖率目标：80%`);
  lines.push(`· 待办完成率目标：75%`);

  return lines.join('\n');
}

function generateReview(type = 'week') {
  const db = ensureDb();
  if (!db) return null;

  let bounds, notes;

  if (type === 'week') {
    bounds = getWeekBounds();
    notes = getNotesByRange(db, bounds.monday, bounds.sunday);
    db.close();
    return formatWeekReport(notes, bounds);
  } else if (type === 'month') {
    bounds = getMonthBounds();
    notes = getNotesByRange(db, bounds.start, bounds.end);
    db.close();
    return formatMonthReport(notes, bounds);
  } else {
    console.error('用法: node review.js [week|month]');
    return null;
  }
}

// CLI
if (require.main === module) {
  const type = process.argv[2] || 'week';
  const report = generateReview(type);
  if (report) {
    console.log(report);
  }
}

module.exports = { generateReview, getNotesByRange, analyzeNotes };
