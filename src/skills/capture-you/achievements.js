#!/usr/bin/env node
/**
 * achievements.js — 隐藏成就系统
 *
 * 成就在满足条件时解锁并提示，
 * 已解锁成就存储在 personality 表的 'achievements' dimension 中。
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'sqlite', 'capture.db');

// ─── 成就定义 ────────────────────────────────────────────

const ACHIEVEMENTS = [
  {
    id: 'first_note',
    emoji: '🌱',
    name: '初来乍到',
    desc: '记录了第一条笔记',
    condition: (stats) => stats.totalNotes >= 1,
  },
  {
    id: 'week_player',
    emoji: '📆',
    name: '一周玩家',
    desc: '连续记录 7 天',
    condition: (stats) => stats.streak.current >= 7,
  },
  {
    id: 'month_player',
    emoji: '📅',
    name: '月度记录者',
    desc: '连续记录 30 天',
    condition: (stats) => stats.streak.current >= 30,
  },
  {
    id: 'note_狂魔',
    emoji: '🔥',
    name: '记录狂魔',
    desc: '单日记录达到 10 条',
    condition: (stats) => stats.maxDaily >= 10,
  },
  {
    id: 'todo_master',
    emoji: '⚡',
    name: '待办终结者',
    desc: '累计完成 50 条待办',
    condition: (stats) => stats.completedTodos >= 50,
  },
  {
    id: 'emotion_obs',
    emoji: '🧭',
    name: '情绪观察者',
    desc: '连续记录 14 天以上',
    condition: (stats) => stats.streak.current >= 14,
  },
  {
    id: 'night_owl',
    emoji: '🌙',
    name: '深夜记录员',
    desc: '首次在 23:00 后记录',
    condition: (stats) => stats.nightRecords >= 1,
  },
  {
    id: 'project_mgr',
    emoji: '📋',
    name: '项目管理者',
    desc: '创建了第一个项目',
    condition: (stats) => stats.totalProjects >= 1,
  },
  {
    id: 'streak_3',
    emoji: '💫',
    name: '三天打鱼',
    desc: '连续记录 3 天',
    condition: (stats) => stats.streak.current >= 3,
  },
  {
    id: 'todo_10',
    emoji: '✅',
    name: '小试牛刀',
    desc: '累计完成 10 条待办',
    condition: (stats) => stats.completedTodos >= 10,
  },
];

// ─── 数据库操作 ────────────────────────────────────────────

function ensureDb(readonly = false) {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly });
}

const fs = require('fs');

function getAchievements() {
  if (!fs.existsSync(DB_PATH)) return [];
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare("SELECT evidence FROM personality WHERE dimension = 'achievements'");
  const row = stmt.get();
  db.close();
  if (!row) return [];
  try {
    return JSON.parse(row.evidence) || [];
  } catch {
    return [];
  }
}

function saveAchievements(achievements) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare(`
    INSERT INTO personality (dimension, evidence, last_updated)
    VALUES ('achievements', ?, ?)
    ON CONFLICT(dimension) DO UPDATE SET evidence = excluded.evidence, last_updated = excluded.last_updated
  `);
  stmt.run(JSON.stringify(achievements), new Date().toISOString());
  db.close();
}

// ─── 统计计算 ────────────────────────────────────────────

function computeStats() {
  if (!fs.existsSync(DB_PATH)) {
    return { totalNotes: 0, completedTodos: 0, streak: { current: 0 }, maxDaily: 0, nightRecords: 0, totalProjects: 0 };
  }
  const db = new Database(DB_PATH, { readonly: true });

  const totalNotes = db.prepare('SELECT COUNT(*) as c FROM notes').get().c;
  const completedTodos = db.prepare('SELECT COUNT(*) as c FROM notes WHERE is_todo = 1 AND todo_done = 1').get().c;

  // 连续天数
  const allDates = db.prepare('SELECT DISTINCT date FROM notes ORDER BY date DESC').all().map(r => r.date);
  const streak = calcStreak(allDates);

  // 单日最高记录数
  const dailyCounts = db.prepare('SELECT date, COUNT(*) as c FROM notes GROUP BY date ORDER BY c DESC').all();
  const maxDaily = dailyCounts.length > 0 ? dailyCounts[0].c : 0;

  // 23点后记录次数
  const nightRecords = db.prepare("SELECT COUNT(*) as c FROM notes WHERE time >= '23:00'").get().c;

  // 项目数
  const totalProjects = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;

  db.close();

  return { totalNotes, completedTodos, streak, maxDaily, nightRecords, totalProjects };
}

function calcStreak(dates) {
  if (!dates || dates.length === 0) return { current: 0, longest: 0 };
  const unique = [...new Set(dates)].sort().reverse();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  let current = 0;
  let longest = 0;
  let streak = 0;
  let prev = null;

  const todayHas = unique[0] === today;
  const yesterdayHas = unique.includes(yesterday) || unique[0] === yesterday;

  if (todayHas || yesterdayHas) {
    let check = todayHas ? today : yesterday;
    while (unique.includes(check)) { current++; const d = new Date(check); d.setDate(d.getDate() - 1); check = d.toISOString().split('T')[0]; }
  }

  for (const date of [...unique].sort()) {
    if (!prev) streak = 1;
    else {
      const d = new Date(prev); d.setDate(d.getDate() - 1);
      streak = (d.toISOString().split('T')[0] === date) ? streak + 1 : 1;
    }
    longest = Math.max(longest, streak);
    prev = date;
  }
  return { current, longest };
}

// ─── 成就检查 ────────────────────────────────────────────

/**
 * 检查是否有新成就解锁
 * @param {object} stats - computeStats() 返回的统计数据
 * @returns {Array} 新解锁的成就列表
 */
function checkNewAchievements(stats) {
  const unlocked = getAchievements();
  const newly = [];

  for (const ach of ACHIEVEMENTS) {
    const already = unlocked.find(a => a.id === ach.id);
    if (!already && ach.condition(stats)) {
      newly.push({
        id: ach.id,
        name: ach.name,
        emoji: ach.emoji,
        desc: ach.desc,
        unlocked_at: new Date().toISOString(),
      });
    }
  }

  return newly;
}

/**
 * 解锁成就（追加到 personality 表）
 */
function unlock(achievements) {
  const existing = getAchievements();
  // 避免重复
  for (const a of achievements) {
    if (!existing.find(e => e.id === a.id)) existing.push(a);
  }
  saveAchievements(existing);
}

/**
 * 格式化成就解锁通知
 */
function formatUnlockNotifications(newly) {
  if (!newly || newly.length === 0) return null;

  const lines = [];
  lines.push('');
  lines.push('\x1b[33m╔━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╗\x1b[0m');
  lines.push('\x1b[33m║\x1b[0m  \x1b[1;33m🎉 新成就解锁！\x1b[0m' + ' '.repeat(26) + '\x1b[33m║\x1b[0m');
  lines.push('\x1b[33m╠━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╣\x1b[0m');

  for (const ach of newly) {
    const msg = `${ach.emoji} ${ach.name} — ${ach.desc}`;
    lines.push(`\x1b[33m║\x1b[0m  ${msg}${' '.repeat(Math.max(0, 41 - msg.length))}\x1b[33m║\x1b[0m`);
  }

  lines.push('\x1b[33m╚━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╝\x1b[0m');
  lines.push('');
  return lines.join('\n');
}

/**
 * 格式化成就列表（用于 profile 等地方展示）
 */
function formatAchievementsList(achievements) {
  if (!achievements || achievements.length === 0) return null;

  const lines = [];
  lines.push(`\x1b[36m╠${'━'.repeat(50)}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m🏆 已解锁成就 (${achievements.length})\x1b[0m${' '.repeat(27)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${'━'.repeat(50)}╣\x1b[0m`);

  // 最近解锁的放前面，最多8个
  const recent = achievements.slice(-8).reverse();
  for (const ach of recent) {
    const date = ach.unlocked_at ? new Date(ach.unlocked_at).toLocaleDateString('zh-CN') : '';
    const msg = `${ach.emoji} ${ach.name}`;
    const dateMsg = date ? ` \x1b[90m${date}\x1b[0m` : '';
    const padding = ' '.repeat(Math.max(0, 40 - msg.length - dateMsg.replace(/\x1b\[\d+m/g, '').length));
    lines.push(`\x1b[36m║\x1b[0m  ${msg}${dateMsg}${padding}\x1b[36m║\x1b[0m`);
  }

  return lines.join('\n');
}

// ─── 主动检查 + 解锁（每次 capture 后调用） ────────────────

/**
 * 检查成就并在有新成就时返回通知字符串
 * @returns {string|null} 通知字符串，无新成就时返回 null
 */
function checkAndNotify() {
  const stats = computeStats();
  const newly = checkNewAchievements(stats);
  if (newly.length > 0) {
    unlock(newly);
    return formatUnlockNotifications(newly);
  }
  return null;
}

// ─── CLI 调试 ────────────────────────────────────────────

if (require.main === module) {
  const stats = computeStats();
  console.log('当前统计：', JSON.stringify(stats, null, 2));
  const newly = checkNewAchievements(stats);
  console.log('新成就：', newly);
  const all = getAchievements();
  console.log('已解锁：', all);
}

module.exports = {
  ACHIEVEMENTS,
  getAchievements,
  saveAchievements,
  computeStats,
  checkNewAchievements,
  unlock,
  formatUnlockNotifications,
  formatAchievementsList,
  checkAndNotify,
};
