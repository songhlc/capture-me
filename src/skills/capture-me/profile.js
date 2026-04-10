#!/usr/bin/env node
/**
 * profile.js — 性格画像生成
 * 分析记录内容，生成渐进式性格分析报告
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'sqlite', 'capture.db');
const { getAchievements, formatAchievementsList } = require('./achievements');

// ─── 关键词库 ────────────────────────────────────────────

const EMOTION_KEYWORDS = {
  positive: ['开心', '顺利', '完成', '成功', '高兴', '兴奋', '满意', '不错', '好', '棒', '突破', '进展'],
  negative: ['焦虑', '压力', '担忧', '烦恼', '郁闷', '沮丧', '失落', '失望', '难', '累', '疲惫', '没睡好'],
  neutral: ['正常', '一般', '平淡', '还好'],
};

const ENERGY_KEYWORDS = {
  high: ['精力充沛', '充满能量', '高效', '专注', '状态好', '神清气爽'],
  low: ['疲惫', '累', '困', '没精神', '能量低', '无力', '疲劳'],
};

const HEALTH_KEYWORDS = {
  sleep: ['睡眠', '睡', '做梦', '失眠', '早睡', '熬夜'],
  exercise: ['运动', '跑步', '健身', '瑜伽', '锻炼', '走路'],
  diet: ['饮食', '吃饭', '外食', '健康', '营养'],
};

// ─── 数据库 ──────────────────────────────────────────────

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

function getRecentNotes(db, days = 30) {
  const since = new Date(); since.setDate(since.getDate() - days);
  return db.prepare(`SELECT * FROM notes WHERE date >= ? ORDER BY date DESC, time DESC`).all(since.toISOString().split('T')[0]);
}

function getNotesInRange(db, startDate, endDate) {
  return db.prepare(`SELECT * FROM notes WHERE date >= ? AND date <= ? ORDER BY date DESC`).all(startDate, endDate);
}

// ─── 分析函数 ────────────────────────────────────────────

function analyzeEmotions(notes) {
  const dist = { positive: 0, negative: 0, neutral: 0 };
  const triggers = { positive: [], negative: [] };
  for (const note of notes) {
    const text = (note.ai_summary || '') + ' ' + (note.raw_text || '');
    let found = null;
    for (const kw of EMOTION_KEYWORDS.positive) { if (text.includes(kw)) { found = 'positive'; triggers.positive.push(kw); break; } }
    if (!found) for (const kw of EMOTION_KEYWORDS.negative) { if (text.includes(kw)) { found = 'negative'; triggers.negative.push(kw); break; } }
    if (!found) for (const kw of EMOTION_KEYWORDS.neutral) { if (text.includes(kw)) { found = 'neutral'; break; } }
    if (!found) dist.neutral++;
    else dist[found]++;
  }
  const total = notes.length || 1;
  return {
    distribution: dist,
    pct: {
      positive: Math.round(dist.positive / total * 100),
      neutral: Math.round(dist.neutral / total * 100),
      negative: Math.round(dist.negative / total * 100),
    },
    triggers: {
      positive: [...new Set(triggers.positive)].slice(0, 4),
      negative: [...new Set(triggers.negative)].slice(0, 4),
    },
  };
}

function analyzeEnergy(notes) {
  let high = 0, low = 0;
  for (const note of notes) {
    const text = (note.ai_summary || '') + ' ' + (note.raw_text || '');
    let found = null;
    for (const kw of ENERGY_KEYWORDS.high) { if (text.includes(kw)) { found = 'high'; break; } }
    if (!found) for (const kw of ENERGY_KEYWORDS.low) { if (text.includes(kw)) { found = 'low'; break; } }
    if (found === 'high') high++;
    else if (found === 'low') low++;
  }
  return { high, low, total: notes.length };
}

function analyzePeople(notes) {
  const counts = {};
  for (const note of notes) {
    if (note.extracted_entities) {
      try {
        const entities = JSON.parse(note.extracted_entities);
        for (const p of entities.people || []) counts[p] = (counts[p] || 0) + 1;
      } catch (e) {}
    }
    if (note.tags) {
      try {
        const tags = JSON.parse(note.tags);
        for (const tag of tags) {
          if (tag.startsWith('@people/')) counts[tag.replace('@people/', '')] = (counts[tag.replace('@people/', '')] || 0) + 1;
        }
      } catch (e) {}
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, c]) => ({ name, count: c }));
}

function analyzeTodos(notes) {
  const todos = notes.filter(n => n.is_todo);
  const completed = todos.filter(n => n.todo_done);
  const pending = todos.filter(n => !n.todo_done);
  const now = new Date();
  const overdue = pending.filter(n => n.todo_due && new Date(n.todo_due) < now);
  const rate = todos.length > 0 ? Math.round(completed.length / todos.length * 100) : 0;
  return { total: todos.length, completed: completed.length, pending: pending.length, overdue: overdue.length, rate };
}

function analyzeHealth(notes) {
  const stats = { sleep: 0, exercise: 0, diet: 0 };
  for (const note of notes) {
    const text = (note.ai_summary || '') + ' ' + (note.raw_text || '');
    for (const kw of HEALTH_KEYWORDS.sleep) { if (text.includes(kw)) { stats.sleep++; break; } }
    for (const kw of HEALTH_KEYWORDS.exercise) { if (text.includes(kw)) { stats.exercise++; break; } }
    for (const kw of HEALTH_KEYWORDS.diet) { if (text.includes(kw)) { stats.diet++; break; } }
  }
  return stats;
}

function analyzeSleepPattern(notes) {
  const byDate = {};
  for (const note of notes) { if (!byDate[note.date]) byDate[note.date] = []; byDate[note.date].push(note); }
  let lateNight = 0, totalDays = 0;
  const lateNightDates = [];
  for (const [date, dayNotes] of Object.entries(byDate)) {
    const latest = dayNotes.reduce((m, n) => n.time > m ? n.time : m, '00:00');
    totalDays++;
    const hour = parseInt(latest.split(':')[0], 10);
    if (hour >= 23) { lateNight++; lateNightDates.push({ date, time: latest }); }
  }
  return { lateNight, totalDays, rate: totalDays > 0 ? Math.round(lateNight / totalDays * 100) : 0, dates: lateNightDates.slice(-7) };
}

// ─── 雷达图 ──────────────────────────────────────────────

function drawRadar(dimensions) {
  // dimensions: [{label, value: 0-1, lastValue: 0-1}, ...]
  // value = 当前周, lastValue = 上周
  const scores = dimensions.map(d => d.value);
  const lastScores = dimensions.map(d => d.lastValue);
  const labels = dimensions.map(d => d.label);

  const N = dimensions.length;
  const maxR = 4; // 雷达半径

  // 生成网格线（3圈）
  const grid = [];
  for (let r = 1; r <= maxR; r++) {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const angle = (Math.PI * 2 * i / N) - Math.PI / 2;
      const x = Math.round(maxR + r * Math.cos(angle));
      const y = Math.round(maxR + r * Math.sin(angle));
      pts.push([x, y]);
    }
    // 闭合多边形
    for (let i = 0; i < N; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % N];
      // 画线段
      drawLineOnGrid(grid, x1, y1, x2, y2, r === maxR ? '─' : '·');
    }
  }

  // 画轴线
  for (let i = 0; i < N; i++) {
    const angle = (Math.PI * 2 * i / N) - Math.PI / 2;
    const x2 = Math.round(maxR + maxR * Math.cos(angle));
    const y2 = Math.round(maxR + maxR * Math.sin(angle));
    drawLineOnGrid(grid, maxR, maxR, x2, y2, '─');
  }

  // 计算当前周多边形顶点
  const currentPts = scores.map((v, i) => {
    const angle = (Math.PI * 2 * i / N) - Math.PI / 2;
    const r = Math.max(0.3, v * maxR); // 最小0.3避免原心
    return [Math.round(maxR + r * Math.cos(angle)), Math.round(maxR + r * Math.sin(angle))];
  });

  // 计算上周多边形顶点
  const lastPts = lastScores.map((v, i) => {
    const angle = (Math.PI * 2 * i / N) - Math.PI / 2;
    const r = Math.max(0.3, v * maxR);
    return [Math.round(maxR + r * Math.cos(angle)), Math.round(maxR + r * Math.sin(angle))];
  });

  // 画当前周多边形（实线）
  for (let i = 0; i < N; i++) {
    drawLineOnGrid(grid, currentPts[i][0], currentPts[i][1], currentPts[(i + 1) % N][0], currentPts[(i + 1) % N][1], '█');
  }

  // 画上周多边形（虚线）
  for (let i = 0; i < N; i++) {
    drawLineOnGrid(grid, lastPts[i][0], lastPts[i][1], lastPts[(i + 1) % N][0], lastPts[(i + 1) % N][1], '▒');
  }

  // 渲染网格（grid[y][x] 或空）
  const W = (maxR + 1) * 2 + 2;
  const H = (maxR + 1) * 2 + 2;
  const canvas = Array.from({ length: H }, () => Array(W).fill(' '));

  // 填网格
  for (const [x, y, ch] of grid) {
    if (x >= 0 && x < W && y >= 0 && y < H) canvas[y][x] = ch;
  }

  // 填数据线（覆盖网格）
  for (let i = 0; i < N; i++) {
    const [x, y] = currentPts[i];
    if (x >= 0 && x < W && y >= 0 && y < H) canvas[y][x] = '●';
  }
  for (let i = 0; i < N; i++) {
    const [x, y] = lastPts[i];
    if (x >= 0 && x < W && y >= 0 && y < H) canvas[y][x] = '○';
  }

  // 标注维度名（定位每个轴的外端）
  const labelPositions = dimensions.map((d, i) => {
    const angle = (Math.PI * 2 * i / N) - Math.PI / 2;
    const lx = Math.round(maxR + (maxR + 0.8) * Math.cos(angle));
    const ly = Math.round(maxR + (maxR + 0.8) * Math.sin(angle));
    return [lx, ly, d.label];
  });

  let result = canvas.map(row => row.join('')).join('\n');

  // 简单用文字标注（替代精确坐标）
  const labelMap = {
    0: '情绪', 1: '能量', 2: '人际', 3: '执行', 4: '健康'
  };
  // 手动定位标注（近似）
  const approxLabels = ['情绪↑', '能量↗', '人际→', '执行↘', '健康←'];

  return result;
}

function drawLineOnGrid(grid, x1, y1, x2, y2, ch) {
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  let x = x1, y = y1;
  while (true) {
    if (!(x === x2 && y === y2)) grid.push([x, y, ch]);
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

// ─── 人格标签 ─────────────────────────────────────────────

function deriveTags({ emotions, energy, people, todos, health, sleep }) {
  const tags = [];

  // 执行力标签
  if (todos.rate >= 80) tags.push({ emoji: '🎯', label: '高效执行者', desc: `完成率${todos.rate}%` });
  else if (todos.rate >= 50) tags.push({ emoji: '⚙️', label: '稳定推进', desc: `完成率${todos.rate}%` });

  // 情绪标签
  if (emotions.pct.positive >= 60) tags.push({ emoji: '☀️', label: '积极乐观', desc: `积极${emotions.pct.positive}%` });
  else if (emotions.pct.negative >= 40) tags.push({ emoji: '🌧️', label: '压力较大', desc: `低落${emotions.pct.negative}%` });
  else if (emotions.pct.neutral >= 60) tags.push({ emoji: '🌤️', label: '心态平和', desc: `平缓${emotions.pct.neutral}%` });

  // 能量标签
  if (energy.total > 0) {
    const highRate = Math.round(energy.high / energy.total * 100);
    if (highRate >= 70) tags.push({ emoji: '⚡', label: '能量充沛', desc: `高能量${highRate}%` });
    else if (highRate <= 30) tags.push({ emoji: '🔋', label: '能量偏低', desc: `低能量${100 - highRate}%` });
  }

  // 关系标签
  if (people.length >= 5) tags.push({ emoji: '🤝', label: '关系达人', desc: `${people.length}位联系人` });
  else if (people.length >= 3) tags.push({ emoji: '👥', label: '社交活跃', desc: `${people.length}位联系人` });

  // 夜型标签
  if (sleep.totalDays > 0 && sleep.rate >= 50) tags.push({ emoji: '🌙', label: '夜型人', desc: `晚睡${sleep.rate}%` });
  else if (sleep.totalDays > 0 && sleep.rate <= 20) tags.push({ emoji: '🌅', label: '早起型', desc: `早睡早起` });

  // 健康标签
  if (health.exercise >= 3) tags.push({ emoji: '🏃', label: '运动达人', desc: `${health.exercise}次运动` });
  if (health.sleep >= 5) tags.push({ emoji: '😴', label: '睡眠关注', desc: `${health.sleep}次记录` });

  // 按优先级排序后取前3（高效执行 > 情绪 > 能量 > 夜型 > 关系 > 健康）
  const priority = ['高效执行者', '稳定推进', '积极乐观', '压力较大', '心态平和', '能量充沛', '能量偏低', '夜型人', '早起型', '关系达人', '社交活跃', '运动达人', '睡眠关注'];
  tags.sort((a, b) => priority.indexOf(a.label) - priority.indexOf(b.label));
  return tags.slice(0, 3);
}

// ─── 周对比（接收预取数据，消除重复查询） ──────────────────

function weekOverWeekFromData(thisWeekNotes, lastWeekNotes) {
  const thisEmotions = analyzeEmotions(thisWeekNotes);
  const lastEmotions = analyzeEmotions(lastWeekNotes);

  const thisTodos = analyzeTodos(thisWeekNotes);
  const lastTodos = analyzeTodos(lastWeekNotes);

  const thisEnergy = analyzeEnergy(thisWeekNotes);
  const lastEnergy = analyzeEnergy(lastWeekNotes);

  const thisHighRate = thisEnergy.total > 0 ? Math.round(thisEnergy.high / thisEnergy.total * 100) : 0;
  const lastHighRate = lastEnergy.total > 0 ? Math.round(lastEnergy.high / lastEnergy.total * 100) : 0;

  return {
    thisWeek: { notes: thisWeekNotes.length, emotions: thisEmotions, todos: thisTodos, energy: thisEnergy },
    lastWeek: { notes: lastWeekNotes.length, emotions: lastEmotions, todos: lastTodos, energy: lastEnergy },
    delta: {
      notes: thisWeekNotes.length - lastWeekNotes.length,
      positiveRate: thisEmotions.pct.positive - lastEmotions.pct.positive,
      todoRate: thisTodos.rate - lastTodos.rate,
      highEnergy: thisHighRate - lastHighRate,
    }
  };
}

// ─── 周对比（原版，保留用于兼容） ─────────────────────────

function weekOverWeek(db) {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dayOfWeek + 1);
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
  const lastSunday = new Date(monday); lastSunday.setDate(monday.getDate() - 1);

  const thisWeek = getNotesInRange(db, monday.toISOString().split('T')[0], now.toISOString().split('T')[0]);
  const lastWeek = getNotesInRange(db, lastMonday.toISOString().split('T')[0], lastSunday.toISOString().split('T')[0]);

  return weekOverWeekFromData(thisWeek, lastWeek);
}

// ─── 雷达数据 ────────────────────────────────────────────

function buildRadarData(wow, health, sleep) {
  const { thisWeek, lastWeek } = wow;

  const emotionScore = thisWeek.emotions.pct.positive / 100;
  const lastEmotionScore = lastWeek.emotions.pct.positive / 100;

  const energyScore = thisWeek.energy.total > 0 ? thisWeek.energy.high / thisWeek.energy.total : 0;
  const lastEnergyScore = lastWeek.energy.total > 0 ? lastWeek.energy.high / lastWeek.energy.total : 0;

  const socialScore = Math.min(1, thisWeek.notes / 30); // 归一化
  const lastSocialScore = Math.min(1, lastWeek.notes / 30);

  const todoScore = thisWeek.todos.total > 0 ? thisWeek.todos.completed / thisWeek.todos.total : 0.5;
  const lastTodoScore = lastWeek.todos.total > 0 ? lastWeek.todos.completed / lastWeek.todos.total : 0.5;

  // 健康分：综合睡眠质量(权重40%)、运动(权重35%)、饮食(权重25%)
  const sleepScore = sleep.totalDays > 0 ? (100 - sleep.rate) / 100 : 0.5;
  const exerciseScore = Math.min(1, health.exercise / 7);
  const dietScore = Math.min(1, health.diet / 5);
  const healthScore = sleepScore * 0.4 + exerciseScore * 0.35 + dietScore * 0.25;
  const lastHealthScore = healthScore; // 健康数据无上周对比时近似取当前值

  return [
    { label: '情绪', value: emotionScore, lastValue: lastEmotionScore },
    { label: '能量', value: energyScore, lastValue: lastEnergyScore },
    { label: '人际', value: socialScore, lastValue: lastSocialScore },
    { label: '执行', value: todoScore, lastValue: lastTodoScore },
    { label: '健康', value: healthScore, lastValue: lastHealthScore },
  ];
}

// ─── 生成画像 ─────────────────────────────────────────────

function getEmptyProfileMessage() {
  return `╔${'━'.repeat(50)}
║  📊 性格画像
╠${'━'.repeat(50)}
║  暂无足够数据生成画像
╚${'━'.repeat(50)}`;
}

/**
 * 优化版：weekOverWeekFromData 接收预取数据，消除 DB 重复查询
 * 6 个 analyzeX 使用 Promise.all 并行执行
 */
async function generateProfileAsync() {
  const db = ensureDb();
  if (!db) return Promise.resolve(null);

  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dayOfWeek + 1);
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
  const lastSunday = new Date(monday); lastSunday.setDate(monday.getDate() - 1);
  const mondayStr = monday.toISOString().split('T')[0];
  const todayStr = now.toISOString().split('T')[0];
  const lastMondayStr = lastMonday.toISOString().split('T')[0];
  const lastSundayStr = lastSunday.toISOString().split('T')[0];

  // 获取数据（better-sqlite3 同步，但这些查询都很轻量）
  const notes = getRecentNotes(db, 30);
  const thisWeekNotes = getNotesInRange(db, mondayStr, todayStr);
  const lastWeekNotes = getNotesInRange(db, lastMondayStr, lastSundayStr);
  db.close();

  if (notes.length === 0) {
    return Promise.resolve(getEmptyProfileMessage());
  }

  // 6 个 analyzeX 并行执行（analyzeX 是同步函数，Promise.resolve 让它们进入微任务队列）
  const [emotions, energy, people, todos, health, sleep] = await Promise.all([
    Promise.resolve(analyzeEmotions(notes)),
    Promise.resolve(analyzeEnergy(notes)),
    Promise.resolve(analyzePeople(notes)),
    Promise.resolve(analyzeTodos(notes)),
    Promise.resolve(analyzeHealth(notes)),
    Promise.resolve(analyzeSleepPattern(notes)),
  ]);

  // weekOverWeekFromData 复用预取数据，不重复查询
  const wow = weekOverWeekFromData(thisWeekNotes, lastWeekNotes);
  const radarData = buildRadarData(wow, health, sleep);
  const personalityTags = deriveTags({ emotions, energy, people, todos, health, sleep });
  const today = now.toISOString().split('T')[0];

  return Promise.resolve(buildProfileOutput({ personalityTags, emotions, energy, people, todos, health, sleep, wow, radarData, today, notesCount: notes.length }));
}

// 构建报告输出（抽离供 generateProfile 和 generateProfileAsync 共用）
function buildProfileOutput({ personalityTags, emotions, energy, people, todos, health, sleep, wow, radarData, today, notesCount }) {

  const bd = '━'.repeat(50);
  const lines = [];

  lines.push('');
  lines.push(`\x1b[36m╔${bd}╗\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1;35m🎭 性格画像 v2.0\x1b[0m${' '.repeat(26)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 人格标签 ──
  if (personalityTags.length > 0) {
    lines.push(`\x1b[36m║\x1b[0m  \x1b[1m🏷️ 人格标签\x1b[0m${' '.repeat(33)}\x1b[36m║\x1b[0m`);
    lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
    const tagLine = personalityTags.map(t => `${t.emoji} ${t.label}`).join('  ');
    const cleanLen = tagLine.replace(/\x1b\[\d+m/g, '').length;
    lines.push(`\x1b[36m║\x1b[0m  ${tagLine}${' '.repeat(Math.max(0, 46 - cleanLen))}\x1b[36m║\x1b[0m`);
    const descLine = personalityTags.map(t => t.desc).join('  ');
    const descLen = descLine.replace(/\x1b\[\d+m/g, '').length;
    lines.push(`\x1b[36m║\x1b[0m  \x1b[90m${descLine}\x1b[0m${' '.repeat(Math.max(0, 46 - descLen))}\x1b[36m║\x1b[0m`);
    lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  }

  // ── 五维对比 ──
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m📊 五维对比（本周 vs 上周）\x1b[0m${' '.repeat(17)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  for (const dim of radarData) {
    const filled = Math.round(dim.value * 10);
    const bar = '\x1b[32m' + '\u2588'.repeat(filled) + '\x1b[90m' + '\u2591'.repeat(10 - filled);
    const delta = Math.round((dim.value - dim.lastValue) * 100);
    const deltaStr = delta > 0 ? `\x1b[32m ↑${delta}%\x1b[0m` : delta < 0 ? `\x1b[31m ↓${Math.abs(delta)}%\x1b[0m` : '\x1b[90m →\x1b[0m';
    const pct = `${Math.round(dim.value * 100)}%`;
    const prevStr = dim.lastValue > 0 ? `\x1b[90m ← ${Math.round(dim.lastValue * 100)}%\x1b[0m` : '\x1b[90m ← --\x1b[0m';
    lines.push(`\x1b[36m║\x1b[0m  ${dim.label}  ${bar}  ${pct}${prevStr}${deltaStr}${' '.repeat(Math.max(0, 32 - bar.length - pct.length - 8 - 6))}\x1b[36m║\x1b[0m`);
  }

  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 雷达图 ──
  const radarLines = drawRadar(radarData).split('\n');
  for (const rl of radarLines) {
    lines.push(`\x1b[36m║\x1b[0m  ${rl.padEnd(48)}\x1b[36m║\x1b[0m`);
  }
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 周对比 ──
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m📅 本周 vs 上周\x1b[0m${' '.repeat(27)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  const delta = wow.delta;
  const makeDelta = (label, val, unit = '条') => {
    if (val === 0) return `\x1b[90m${label}：持平\x1b[0m`;
    const arrow = val > 0 ? '↑' : '↓';
    const color = val > 0 ? '\x1b[32m' : '\x1b[31m';
    return `${color}${label}：${arrow}${Math.abs(val)}${unit}\x1b[0m`;
  };

  const noteDelta = makeDelta('记录数', delta.notes);
  const posDelta = makeDelta('积极情绪', delta.positiveRate, '%');
  const todoDelta = makeDelta('完成率', delta.todoRate, '%');
  const energyDelta = makeDelta('高能量', delta.highEnergy, '%');

  lines.push(`\x1b[36m║\x1b[0m  ${noteDelta}${' '.repeat(Math.max(0, 35 - noteDelta.replace(/\x1b\[\d+m/g, '').length))}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  ${posDelta}${' '.repeat(Math.max(0, 35 - posDelta.replace(/\x1b\[\d+m/g, '').length))}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  ${todoDelta}${' '.repeat(Math.max(0, 35 - todoDelta.replace(/\x1b\[\d+m/g, '').length))}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  ${energyDelta}${' '.repeat(Math.max(0, 35 - energyDelta.replace(/\x1b\[\d+m/g, '').length))}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 情绪仪表盘 ──
  const emoPct = emotions.pct;
  const makeBar = (pct) => {
    const filled = Math.round(pct / 10);
    return `\x1b[32m${'█'.repeat(filled)}${'░'.repeat(10 - filled)}\x1b[0m ${String(pct).padStart(2)}%`;
  };

  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m😊 情绪仪表盘\x1b[0m${' '.repeat(28)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[32m积极 ${makeBar(emoPct.positive)}  ${emotions.distribution.positive}次\x1b[0m\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[33m平缓 ${makeBar(emoPct.neutral)}  ${emotions.distribution.neutral}次\x1b[0m\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[31m低落 ${makeBar(emoPct.negative)}  ${emotions.distribution.negative}次\x1b[0m\x1b[36m║\x1b[0m`);
  if (emotions.triggers.positive.length > 0 || emotions.triggers.negative.length > 0) {
    const posKw = emotions.triggers.positive.join('/') || '-';
    const negKw = emotions.triggers.negative.join('/') || '-';
    lines.push(`\x1b[36m║\x1b[0m  \x1b[90m触发\x1b[0m \x1b[32m${posKw}\x1b[0m \x1b[90m/\x1b[0m \x1b[31m${negKw}\x1b[0m\x1b[36m║\x1b[0m`);
  }
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 关系网络 ──
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m👥 关系网络\x1b[0m${' '.repeat(29)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  if (people.length > 0) {
    for (const p of people.slice(0, 3)) {
      const dots = '●'.repeat(Math.min(p.count, 5)) + '○'.repeat(Math.max(0, 5 - p.count));
      lines.push(`\x1b[36m║\x1b[0m  \x1b[34m${p.name}\x1b[0m ${dots} ${p.count}次\x1b[36m║\x1b[0m`);
    }
  } else {
    lines.push(`\x1b[36m║\x1b[0m  \x1b[90m暂无数据\x1b[0m${' '.repeat(34)}\x1b[36m║\x1b[0m`);
  }
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 执行力 ──
  const todoBarLen = Math.round(todos.rate / 10);
  const todoBar = `\x1b[32m${'█'.repeat(todoBarLen)}${'░'.repeat(10 - todoBarLen)}\x1b[0m`;
  const todoStatus = todos.pending > 0 ? `\x1b[31m⏳ ${todos.pending}待处理\x1b[0m` : todos.total > 0 ? '\x1b[32m✓ 全部完成\x1b[0m' : '\x1b[90m暂无待办\x1b[0m';

  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m🎯 执行力\x1b[0m${' '.repeat(32)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[90m完成率\x1b[0m ${todoBar} ${todos.rate}%\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  ${todoStatus}${' '.repeat(Math.max(0, 35 - todoStatus.replace(/\x1b\[\d+m/g, '').length))}\x1b[36m║\x1b[0m`);
  if (todos.overdue > 0) {
    lines.push(`\x1b[36m║\x1b[0m  \x1b[31m⚠️ 逾期 ${todos.overdue} 条\x1b[0m${' '.repeat(28)}\x1b[36m║\x1b[0m`);
  }
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);

  // ── 健康追踪 ──
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m🏃 健康追踪\x1b[0m${' '.repeat(29)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[90m睡眠\x1b[0m \x1b[34m●\x1b[0m ${String(health.sleep).padStart(2)}  \x1b[90m运动\x1b[0m \x1b[32m●\x1b[0m ${String(health.exercise).padStart(2)}  \x1b[90m饮食\x1b[0m \x1b[33m●\x1b[0m ${String(health.diet).padStart(2)}\x1b[36m║\x1b[0m`);

  if (sleep.totalDays > 0) {
    const sleepColor = sleep.rate > 50 ? '\x1b[31m' : '\x1b[33m';
    const sleepBarLen = Math.round(sleep.rate / 10);
    const sleepBar = `${sleepColor}${'█'.repeat(sleepBarLen)}${'░'.repeat(10 - sleepBarLen)}\x1b[0m`;
    lines.push(`\x1b[36m║\x1b[0m  \x1b[90m晚睡率\x1b[0m ${sleepBar} ${String(sleep.rate).padStart(2)}%  \x1b[90m(${sleep.lateNight}/${sleep.totalDays}天)\x1b[0m\x1b[36m║\x1b[0m`);
  }

  // ── 成就 ──
  const achievements = getAchievements();
  if (achievements.length > 0) {
    const achSection = formatAchievementsList(achievements);
    if (achSection) {
      for (const line of achSection.split('\n')) {
        lines.push(line);
      }
    }
  }

  lines.push(`\x1b[36m╠${bd}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[2m分析于 ${today}  |  ${notesCount}条记录\x1b[0m${' '.repeat(13)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╚${bd}╝\x1b[0m`);
  lines.push('');

  return lines.join('\n');
}

// ─── CLI ────────────────────────────────────────────────

if (require.main === module) {
  generateProfileAsync().then(output => console.log(output));
}

module.exports = { generateProfileAsync, buildProfileOutput, analyzeEmotions, analyzePeople, analyzeTodos };
