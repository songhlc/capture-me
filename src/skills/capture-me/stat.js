#!/usr/bin/env node
/**
 * stat.js — 记录统计
 * 查看记录数量、标签分布、待办统计等
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'sqlite', 'capture.db');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

// ─── 连续天数计算 ────────────────────────────────────────

function calcStreak(dates) {
  if (!dates || dates.length === 0) return { current: 0, longest: 0, todayHas: false };

  const unique = [...new Set(dates)].sort().reverse();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  let current = 0;
  let longest = 0;
  let streak = 0;
  let prevDate = null;

  const todayHas = unique[0] === today;
  const yesterdayHas = unique.includes(yesterday) || unique[0] === yesterday;

  // 计算当前连续天数（从昨天或今天往前数）
  if (todayHas || yesterdayHas) {
    let checkDate = todayHas ? today : yesterday;
    while (unique.includes(checkDate)) {
      current++;
      const d = new Date(checkDate);
      d.setDate(d.getDate() - 1);
      checkDate = d.toISOString().split('T')[0];
    }
  }

  // 计算历史最长连续
  for (const date of [...unique].sort()) {
    if (!prevDate) { streak = 1; }
    else {
      const d = new Date(prevDate);
      d.setDate(d.getDate() - 1);
      if (d.toISOString().split('T')[0] === date) { streak++; }
      else { streak = 1; }
    }
    longest = Math.max(longest, streak);
    prevDate = date;
  }

  return { current, longest, todayHas };
}

// ─── Sparkline ───────────────────────────────────────────

function makeSparkline(dailyTrend, maxBars = 20) {
  if (!dailyTrend || dailyTrend.length === 0) return '▁' .repeat(maxBars);

  const counts = dailyTrend.map(d => d.count);
  const max = Math.max(...counts, 1);
  const min = Math.min(...counts, 0);
  const range = max - min || 1;

  // 取最近 maxBars 天
  const recent = counts.slice(-maxBars);
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  return recent.map(c => {
    const idx = Math.round((c - min) / range * (blocks.length - 1));
    return blocks[Math.min(idx, blocks.length - 1)];
  }).join('');
}

// ─── Insight 生成 ─────────────────────────────────────────

function generateInsight(stats) {
  const insights = [];

  // 连续记录洞察
  if (stats.streak.current >= 7) {
    insights.push(`🔥 已连续记录 ${stats.streak.current} 天，状态很稳！`);
  } else if (stats.streak.current >= 3) {
    insights.push(`📈 连续记录 ${stats.streak.current} 天，保持这个节奏`);
  } else if (stats.streak.todayHas) {
    insights.push(`✨ 今天已经开始记录了`);
  } else {
    insights.push(`💡 今天还没记录，赶紧记一条吧`);
  }

  // 周对比洞察
  if (stats.weekDelta !== 0) {
    const arrow = stats.weekDelta > 0 ? '↑' : '↓';
    const color = stats.weekDelta > 0 ? '32' : '31';
    insights.push(`\x1b[${color}m📅 本周${arrow}${Math.abs(stats.weekDelta)}条\x1b[0m`);
  }

  // 待办洞察
  if (stats.overdueTodos > 0) {
    insights.push(`\x1b[31m⚠️ 有 ${stats.overdueTodos} 条逾期待办\x1b[0m`);
  } else if (stats.pendingTodos > 0) {
    insights.push(`📋 ${stats.pendingTodos} 条待办在手`);
  }

  // 情绪洞察（如果有数据）
  if (stats.topEmotion) {
    insights.push(`😊 最近情绪以${stats.topEmotion}为主`);
  }

  return insights;
}

// ─── 空数据兜底 ─────────────────────────────────────────

function getEmptyStats() {
  return {
    totalNotes: 0, weekNotes: 0, weekDelta: 0, monthNotes: 0,
    totalTodos: 0, pendingTodos: 0, completedTodos: 0, overdueTodos: 0,
    weekTodos: 0, weekTodosDone: 0,
    categories: [], dailyTrend: [], allDates: [], topEmotion: '平缓',
    streak: { current: 0, longest: 0, todayHas: false },
  };
}

// ─── 错误隔离 ────────────────────────────────────────────

function safeQuery(promise, fallback) {
  return promise
    .then(r => r)
    .catch(err => { console.error('Query failed:', err.message); return fallback; });
}

// ─── 优化查询（3 个并行） ─────────────────────────────────

/**
 * Query A: 10 个 COUNT 合并为 1 个
 */
function queryCounts(db, today, mondayStr, lastMondayStr, lastSundayStr, monthStart) {
  return db.prepare(`
    SELECT
      COUNT(*) as totalNotes,
      SUM(CASE WHEN date >= ? THEN 1 ELSE 0 END) as weekNotes,
      SUM(CASE WHEN date >= ? AND date <= ? THEN 1 ELSE 0 END) as weekNotesLast,
      SUM(CASE WHEN date >= ? THEN 1 ELSE 0 END) as monthNotes,
      SUM(CASE WHEN is_todo = 1 THEN 1 ELSE 0 END) as totalTodos,
      SUM(CASE WHEN is_todo = 1 AND todo_done = 0 THEN 1 ELSE 0 END) as pendingTodos,
      SUM(CASE WHEN is_todo = 1 AND todo_done = 1 THEN 1 ELSE 0 END) as completedTodos,
      SUM(CASE WHEN is_todo = 1 AND todo_done = 0 AND todo_due < ? THEN 1 ELSE 0 END) as overdueTodos,
      SUM(CASE WHEN is_todo = 1 AND date >= ? THEN 1 ELSE 0 END) as weekTodos,
      SUM(CASE WHEN is_todo = 1 AND todo_done = 1 AND date >= ? THEN 1 ELSE 0 END) as weekTodosDone
    FROM notes
  `).get(mondayStr, lastMondayStr, lastSundayStr, monthStart, today, mondayStr, mondayStr);
}

/**
 * Query B: categories（无日期过滤，匹配原有逻辑）
 * 原有 categories 查询：SELECT category, COUNT(*) as c FROM notes WHERE category IS NOT NULL GROUP BY category ORDER BY c DESC
 */
function queryCategories(db) {
  return db.prepare(`
    SELECT category, COUNT(*) as c
    FROM notes
    WHERE category IS NOT NULL
    GROUP BY category
    ORDER BY c DESC
  `).all();
}

/**
 * Query D: dailyTrend + allDates 合并
 * dailyTrend: ALL notes by date（无 category 过滤），allDates: 仅 30 天内的日期
 */
function queryDailyAndDates(db, thirtyDaysAgoStr) {
  const dailyRows = db.prepare(`
    SELECT date, COUNT(*) as count
    FROM notes
    WHERE date >= ?
    GROUP BY date
    ORDER BY date
  `).all(thirtyDaysAgoStr);

  // allDates 从 dailyTrend 提取（保持 30 天过滤）
  const allDates = dailyRows.map(r => r.date).reverse();

  return { dailyTrend: dailyRows, allDates };
}

/**
 * Query C: recent30 情绪数据
 */
function queryRecent30(db, thirtyDaysAgoStr) {
  return db.prepare(`SELECT ai_summary, raw_text FROM notes WHERE date >= ?`).all(thirtyDaysAgoStr);
}

// ─── 情绪计算（复用） ─────────────────────────────────────

function computeTopEmotion(recent30) {
  const posWords = ['开心', '顺利', '完成', '成功', '高兴', '兴奋', '满意', '突破', '进展', '不错'];
  const negWords = ['焦虑', '压力', '担忧', '烦恼', '郁闷', '沮丧', '累', '疲惫', '难'];
  let pos = 0, neg = 0;
  for (const n of recent30) {
    const text = (n.ai_summary || '') + (n.raw_text || '');
    if (posWords.some(w => text.includes(w))) pos++;
    if (negWords.some(w => text.includes(w))) neg++;
  }
  return pos > neg ? '积极' : neg > pos ? '低落' : '平缓';
}

// ─── 优化版：getStatsAsync ────────────────────────────────

function getStatsAsync() {
  const db = ensureDb();
  if (!db) return Promise.resolve(getEmptyStats());

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dayOfWeek + 1);
  const mondayStr = monday.toISOString().split('T')[0];
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
  const lastSunday = new Date(monday); lastSunday.setDate(monday.getDate() - 1);
  const lastMondayStr = lastMonday.toISOString().split('T')[0];
  const lastSundayStr = lastSunday.toISOString().split('T')[0];
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  // 4 个并行查询（categories 独立，其余 3 并行）
  return Promise.all([
    safeQuery(Promise.resolve(queryCounts(db, today, mondayStr, lastMondayStr, lastSundayStr, monthStart)), {}),
    safeQuery(Promise.resolve(queryCategories(db)), []),
    safeQuery(Promise.resolve(queryDailyAndDates(db, thirtyDaysAgoStr)), { dailyTrend: [], allDates: [] }),
    safeQuery(Promise.resolve(queryRecent30(db, thirtyDaysAgoStr)), []),
  ]).then(([counts, categories, dailyAndDates, recent30]) => {
    db.close();

    const {
      totalNotes = 0, weekNotes = 0, weekNotesLast = 0, monthNotes = 0,
      totalTodos = 0, pendingTodos = 0, completedTodos = 0, overdueTodos = 0,
      weekTodos = 0, weekTodosDone = 0,
    } = counts;

    const { dailyTrend = [], allDates = [] } = dailyAndDates;
    const topEmotion = computeTopEmotion(recent30);

    return {
      totalNotes, weekNotes, weekDelta: weekNotes - weekNotesLast, monthNotes,
      totalTodos, pendingTodos, completedTodos, overdueTodos,
      weekTodos, weekTodosDone,
      categories, dailyTrend, allDates, topEmotion,
      streak: calcStreak(allDates),
    };
  });
}

// ─── 数据获取（原有同步版本，保留用于回滚） ──────────────────

function getStats(db) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const totalNotes = db.prepare('SELECT COUNT(*) as c FROM notes').get().c;

  // 本周
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dayOfWeek + 1);
  const mondayStr = monday.toISOString().split('T')[0];
  const weekNotes = db.prepare('SELECT COUNT(*) as c FROM notes WHERE date >= ?').get(mondayStr).c;

  // 上周
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
  const lastSunday = new Date(monday); lastSunday.setDate(monday.getDate() - 1);
  const weekNotesLast = db.prepare('SELECT COUNT(*) as c FROM notes WHERE date >= ? AND date <= ?')
    .get(lastMonday.toISOString().split('T')[0], lastSunday.toISOString().split('T')[0]).c;

  const weekDelta = weekNotes - weekNotesLast;

  // 本月
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthNotes = db.prepare('SELECT COUNT(*) as c FROM notes WHERE date >= ?').get(monthStart).c;

  // 待办
  const totalTodos = db.prepare('SELECT COUNT(*) as c FROM notes WHERE is_todo = 1').get().c;
  const pendingTodos = db.prepare('SELECT COUNT(*) as c FROM notes WHERE is_todo = 1 AND todo_done = 0').get().c;
  const completedTodos = db.prepare('SELECT COUNT(*) as c FROM notes WHERE is_todo = 1 AND todo_done = 1').get().c;
  const overdueTodos = db.prepare(`SELECT COUNT(*) as c FROM notes WHERE is_todo = 1 AND todo_done = 0 AND todo_due < ?`).get(today).c;

  // 本周新增待办
  const weekTodos = db.prepare('SELECT COUNT(*) as c FROM notes WHERE is_todo = 1 AND date >= ?').get(mondayStr).c;
  const weekTodosDone = db.prepare('SELECT COUNT(*) as c FROM notes WHERE is_todo = 1 AND todo_done = 1 AND date >= ?').get(mondayStr).c;

  // 分类
  const categories = db.prepare(`SELECT category, COUNT(*) as c FROM notes WHERE category IS NOT NULL GROUP BY category ORDER BY c DESC`).all();

  // 30 天趋势
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dailyTrend = db.prepare(`SELECT date, COUNT(*) as count FROM notes WHERE date >= ? GROUP BY date ORDER BY date`).all(thirtyDaysAgo.toISOString().split('T')[0]);

  // 所有记录日期（用于连续计算）
  const allDates = db.prepare('SELECT DISTINCT date FROM notes ORDER BY date DESC').all().map(r => r.date);

  // 情绪统计（从 ai_summary 关键词推断）
  const recent30 = db.prepare(`SELECT ai_summary, raw_text FROM notes WHERE date >= ?`).all(thirtyDaysAgo.toISOString().split('T')[0]);
  const posWords = ['开心', '顺利', '完成', '成功', '高兴', '兴奋', '满意', '突破', '进展', '不错'];
  const negWords = ['焦虑', '压力', '担忧', '烦恼', '郁闷', '沮丧', '累', '疲惫', '难'];
  let pos = 0, neg = 0;
  for (const n of recent30) {
    const text = (n.ai_summary || '') + (n.raw_text || '');
    if (posWords.some(w => text.includes(w))) pos++;
    if (negWords.some(w => text.includes(w))) neg++;
  }
  const topEmotion = pos > neg ? '积极' : neg > pos ? '低落' : '平缓';

  return {
    totalNotes, weekNotes, weekDelta, monthNotes,
    totalTodos, pendingTodos, completedTodos, overdueTodos,
    weekTodos, weekTodosDone,
    categories, dailyTrend, allDates, topEmotion,
    streak: calcStreak(allDates),
  };
}

// ─── 格式化输出 ──────────────────────────────────────────

const CAT_COLORS = {
  life: '38;5;75', work: '38;5;74', health: '38;5;71',
  idea: '38;5;141', goal: '38;5;208', investment: '38;5;172',
};

function formatStats(stats) {
  const today = new Date().toISOString().split('T')[0];
  const bd = '━'.repeat(50);

  const lines = [];
  lines.push('');
  lines.push(`\x1b[36m╔${bd}╗\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1;36m📊 CAPTURE-ME 仪表盘\x1b[0m  \x1b[36m${bd.slice(22)}║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 连续记录 ──
  const streak = stats.streak;
  const streakEmoji = streak.current >= 7 ? '🔥' : streak.current >= 3 ? '📈' : '💡';
  const streakDesc = streak.current > 0
    ? `${streak.current} 天（最长 ${streak.longest}）`
    : streak.todayHas ? '今天已开始' : '今日未记';
  const streakColor = streak.current >= 7 ? '\x1b[32m' : streak.current >= 3 ? '\x1b[33m' : '\x1b[90m';

  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m${streakEmoji} 连续记录\x1b[0m${' '.repeat(29)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  ${streakColor}${streakDesc}\x1b[0m${' '.repeat(Math.max(0, 45 - streakDesc.length))}\x1b[36m║\x1b[0m`);

  // ── 记录概览 ──
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m📝 记录概览\x1b[0m${' '.repeat(32)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[32m总记录\x1b[0m   \x1b[1m${stats.totalNotes}\x1b[0m    \x1b[90m条\x1b[0m${' '.repeat(26)}\x1b[36m║\x1b[0m`);

  const weekDeltaStr = stats.weekDelta !== 0
    ? (stats.weekDelta > 0 ? `\x1b[32m +${stats.weekDelta}\x1b[0m` : `\x1b[31m ${stats.weekDelta}\x1b[0m`) : '';
  const weekPad = 26 - String(Math.abs(stats.weekDelta)).length - (stats.weekDelta > 0 ? 1 : 0);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[32m本周新增\x1b[0m \x1b[1m${stats.weekNotes}\x1b[0m\x1b[90m条\x1b[0m${weekDeltaStr ? ` ${weekDeltaStr}` : ''}${' '.repeat(Math.max(0, weekPad))}\x1b[36m║\x1b[0m`);

  lines.push(`\x1b[36m║\x1b[0m  \x1b[32m本月新增\x1b[0m \x1b[1m${stats.monthNotes}\x1b[0m    \x1b[90m条\x1b[0m${' '.repeat(25)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 30天趋势图 ──
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m📈 30天趋势\x1b[0m${' '.repeat(31)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  const sparkline = makeSparkline(stats.dailyTrend);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[32m${sparkline}\x1b[0m${' '.repeat(Math.max(0, 45 - sparkline.length))}\x1b[36m║\x1b[0m`);

  const total30 = stats.dailyTrend.reduce((s, d) => s + d.count, 0);
  const avg30 = stats.dailyTrend.length > 0 ? (total30 / stats.dailyTrend.length).toFixed(1) : '0';
  lines.push(`\x1b[36m║\x1b[0m  \x1b[90m日均 ${avg30} 条  ${stats.dailyTrend.length} 天有记录\x1b[0m${' '.repeat(Math.max(0, 13))}\x1b[36m║\x1b[0m`);

  // ── 待办 ──
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  const todoPct = stats.totalTodos > 0 ? Math.round(stats.completedTodos / stats.totalTodos * 100) : 0;
  const todoBarLen = Math.round(todoPct / 10);
  const todoBar = `\x1b[32m${'█'.repeat(todoBarLen)}\x1b[0m${'░'.repeat(10 - todoBarLen)}`;
  const todoStatus = stats.pendingTodos > 0
    ? `\x1b[31m⏳ ${stats.pendingTodos} 待处理\x1b[0m`
    : stats.totalTodos > 0 ? '\x1b[32m✓ 全部完成\x1b[0m' : '\x1b[90m暂无待办\x1b[0m';

  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m📋 待办状态\x1b[0m${' '.repeat(31)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[90m完成率\x1b[0m  ${todoBar} ${todoPct}%  \x1b[90m(${stats.completedTodos}/${stats.totalTodos})\x1b[0m${' '.repeat(4)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  ${todoStatus}${' '.repeat(Math.max(0, 35 - todoStatus.replace(/\x1b\[\d+m/g, '').length))}\x1b[36m║\x1b[0m`);

  // 本周待办消化
  if (stats.weekTodos > 0) {
    const weekTodoPct = Math.round(stats.weekTodosDone / stats.weekTodos * 100);
    lines.push(`\x1b[36m║\x1b[0m  \x1b[90m本周消化\x1b[0m \x1b[1m${stats.weekTodosDone}/${stats.weekTodos}\x1b[0m\x1b[90m（${weekTodoPct}%）\x1b[0m${' '.repeat(13)}\x1b[36m║\x1b[0m`);
  }

  if (stats.overdueTodos > 0) {
    lines.push(`\x1b[36m║\x1b[0m  \x1b[31m⚠️ 逾期 ${stats.overdueTodos} 条\x1b[0m${' '.repeat(28)}\x1b[36m║\x1b[0m`);
  }
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 分类分布 ──
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m📂 分类分布\x1b[0m${' '.repeat(32)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  if (stats.categories.length > 0) {
    const maxCount = Math.max(...stats.categories.map(c => c.c));
    for (const cat of stats.categories.slice(0, 5)) {
      const barLen = Math.round(cat.c / maxCount * 18);
      const bar = '\x1b[32m' + '█'.repeat(barLen);
      const catName = (cat.category || '未分类').padEnd(10);
      const countStr = String(cat.c).padStart(3);
      const colorCode = CAT_COLORS[cat.category] || '38;5;245';
      const padding = ' '.repeat(Math.max(0, 17 - barLen));
      lines.push(`\x1b[36m║\x1b[0m  \x1b[${colorCode}m${catName}\x1b[0m ${bar}${padding}\x1b[0m ${countStr} \x1b[90m条\x1b[0m\x1b[36m║\x1b[0m`);
    }
  } else {
    lines.push(`\x1b[36m║\x1b[0m  \x1b[90m暂无数据\x1b[0m${' '.repeat(37)}\x1b[36m║\x1b[0m`);
  }

  // ── Insight ──
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m💡 即时洞察\x1b[0m${' '.repeat(32)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  const insights = generateInsight(stats);
  for (const insight of insights) {
    const cleanLen = insight.replace(/\x1b\[\d+m/g, '').length;
    lines.push(`\x1b[36m║\x1b[0m  ${insight}${' '.repeat(Math.max(0, 45 - cleanLen))}\x1b[36m║\x1b[0m`);
  }

  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[2m统计于 ${today}  |  capture-me\x1b[0m${' '.repeat(19)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╚${bd}╝\x1b[0m`);
  lines.push('');

  return lines.join('\n');
}

// ─── CLI ────────────────────────────────────────────────

if (require.main === module) {
  const db = ensureDb();
  if (!db) {
    const bd = '━'.repeat(50);
    console.log(`\n\x1b[36m╔${bd}╗\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m  \x1b[1m📊 CAPTURE-ME 仪表盘\x1b[0m${' '.repeat(25)}\x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m╠${bd}╣\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m  \x1b[90m暂无数据，请先记录一些内容\x1b[0m${' '.repeat(19)}\x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m╚${bd}╝\x1b[0m\n`);
    process.exit(0);
  }
  const stats = getStats(db);
  db.close();
  console.log(formatStats(stats));
}

module.exports = { getStats, getStatsAsync, formatStats, calcStreak, makeSparkline, getEmptyStats };
