#!/usr/bin/env node
/**
 * profile.js — 性格画像生成
 * 分析记录内容，生成渐进式性格分析报告
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// 用户数据目录：.claude/skills/capture-you/memory/
const MEMORY_DIR = path.join(__dirname, 'memory');
const DB_PATH = path.join(__dirname, 'sqlite', 'capture.db');
const PROFILE_FILE = path.join(MEMORY_DIR, 'personality.md');

// 情绪关键词
const EMOTION_KEYWORDS = {
  positive: ['开心', '顺利', '完成', '成功', '高兴', '兴奋', '满意', '不错', '好', '棒', '突破', '进展'],
  negative: ['焦虑', '压力', '担忧', '烦恼', '郁闷', '沮丧', '失落', '失望', '难', '累', '疲惫', '没睡好'],
  neutral: ['正常', '一般', '平淡', '还好'],
};

// 能量关键词
const ENERGY_KEYWORDS = {
  high: ['精力充沛', '充满能量', '高效', '专注', '状态好', '神清气爽'],
  low: ['疲惫', '累', '困', '没精神', '能量低', '无力', '疲劳'],
};

// 健康关键词
const HEALTH_KEYWORDS = {
  sleep: ['睡眠', '睡', '做梦', '失眠', '早睡', '熬夜'],
  exercise: ['运动', '跑步', '健身', '瑜伽', '锻炼', '走路'],
  diet: ['饮食', '吃饭', '外食', '健康', '营养'],
};

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('数据库不存在，运行 review.js 初始化');
    return null;
  }
  return new Database(DB_PATH, { readonly: true });
}

function getRecentNotes(db, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const stmt = db.prepare(`
    SELECT * FROM notes
    WHERE date >= ?
    ORDER BY date DESC, time DESC
  `);
  return stmt.all(sinceStr);
}

function analyzeEmotions(notes) {
  const distribution = { positive: 0, negative: 0, neutral: 0 };
  const triggers = { positive: [], negative: [] };

  for (const note of notes) {
    const text = note.raw_text + ' ' + (note.ai_summary || '');
    let found = null;

    for (const kw of EMOTION_KEYWORDS.positive) {
      if (text.includes(kw)) {
        found = 'positive';
        triggers.positive.push(kw);
        break;
      }
    }
    if (!found) {
      for (const kw of EMOTION_KEYWORDS.negative) {
        if (text.includes(kw)) {
          found = 'negative';
          triggers.negative.push(kw);
          break;
        }
      }
    }
    if (!found) {
      for (const kw of EMOTION_KEYWORDS.neutral) {
        if (text.includes(kw)) {
          found = 'neutral';
          break;
        }
      }
    }
    if (!found) distribution.neutral++;
    else distribution[found]++;
  }

  const total = notes.length || 1;
  return {
    distribution,
    percentages: {
      positive: Math.round(distribution.positive / total * 100),
      neutral: Math.round(distribution.neutral / total * 100),
      negative: Math.round(distribution.negative / total * 100),
    },
    triggers: {
      positive: [...new Set(triggers.positive)],
      negative: [...new Set(triggers.negative)],
    },
  };
}

function analyzeEnergy(notes) {
  const energyByDay = {};
  let highCount = 0, lowCount = 0;

  for (const note of notes) {
    const text = note.raw_text + ' ' + (note.ai_summary || '');
    let found = null;

    for (const kw of ENERGY_KEYWORDS.high) {
      if (text.includes(kw)) { found = 'high'; break; }
    }
    if (!found) {
      for (const kw of ENERGY_KEYWORDS.low) {
        if (text.includes(kw)) { found = 'low'; break; }
      }
    }

    if (found === 'high') highCount++;
    else if (found === 'low') lowCount++;
  }

  return { highCount, lowCount, total: notes.length };
}

function analyzePeople(notes) {
  const peopleCounts = {};
  const peopleTypes = { 老板: 0, colleague: 0, partner: 0, other: 0 };

  const peopleRegex = /([A-Za-z\u4e00-\u9fa5]{2,4})(总|经理|总经|老|哥|姐|总)/g;

  for (const note of notes) {
    if (note.extracted_entities) {
      try {
        const entities = JSON.parse(note.extracted_entities);
        for (const person of entities.people || []) {
          peopleCounts[person] = (peopleCounts[person] || 0) + 1;
        }
      } catch (e) {}
    }

    // 从标签推断
    if (note.tags) {
      try {
        const tags = JSON.parse(note.tags);
        for (const tag of tags) {
          if (tag.startsWith('@people/')) {
            const type = tag.replace('@people/', '');
            peopleTypes[type] = (peopleTypes[type] || 0) + 1;
          }
        }
      } catch (e) {}
    }
  }

  const topPeople = Object.entries(peopleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return { topPeople, types: peopleTypes };
}

function analyzeTodos(notes) {
  const todos = notes.filter(n => n.is_todo);
  const completed = todos.filter(n => n.todo_done);
  const pending = todos.filter(n => !n.todo_done);

  const now = new Date();
  const overdue = pending.filter(n => n.todo_due && new Date(n.todo_due) < now);

  const completionRate = todos.length > 0
    ? Math.round(completed.length / todos.length * 100)
    : 0;

  return {
    total: todos.length,
    completed: completed.length,
    pending: pending.length,
    overdue: overdue.length,
    completionRate,
  };
}

function analyzeHealth(notes) {
  const stats = { sleep: 0, exercise: 0, diet: 0 };

  for (const note of notes) {
    const text = note.raw_text + ' ' + (note.ai_summary || '');
    for (const kw of HEALTH_KEYWORDS.sleep) {
      if (text.includes(kw)) { stats.sleep++; break; }
    }
    for (const kw of HEALTH_KEYWORDS.exercise) {
      if (text.includes(kw)) { stats.exercise++; break; }
    }
    for (const kw of HEALTH_KEYWORDS.diet) {
      if (text.includes(kw)) { stats.diet++; break; }
    }
  }

  return stats;
}

function analyzeCategories(notes) {
  const counts = {};
  for (const note of notes) {
    if (note.category) {
      counts[note.category] = (counts[note.category] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function generateProfile() {
  const db = ensureDb();
  if (!db) return null;

  const notes = getRecentNotes(db, 30);
  db.close();

  if (notes.length === 0) {
    return '📊 性格画像\n\n暂无足够数据生成画像，请先记录一些内容。';
  }

  const emotions = analyzeEmotions(notes);
  const energy = analyzeEnergy(notes);
  const people = analyzePeople(notes);
  const todos = analyzeTodos(notes);
  const health = analyzeHealth(notes);
  const categories = analyzeCategories(notes);

  const today = new Date().toISOString().split('T')[0];

  const output = [
    `📊 性格画像 v1.0（持续更新）`,
    `═══════════════════════════════════════`,
    ``,
    `## 📊 情绪仪表盘`,
    `  近30天情绪分布（${notes.length}条记录）：`,
    `  🟢 积极：${emotions.distribution.positive}次（${emotions.percentages.positive}%）`,
    `  🟡 平缓：${emotions.distribution.neutral}次（${emotions.percentages.neutral}%）`,
    `  🔴 低落：${emotions.distribution.negative}次（${emotions.percentages.negative}%）`,
    ``,
    `  情绪触发词：`,
  ];

  if (emotions.triggers.positive.length > 0) {
    output.push(`  · 正向：${emotions.triggers.positive.slice(0, 5).join(' / ')}`);
  }
  if (emotions.triggers.negative.length > 0) {
    output.push(`  · 负向：${emotions.triggers.negative.slice(0, 5).join(' / ')}`);
  }

  output.push(``);
  output.push(`## ⚡ 能量状态追踪`);

  const avgEnergy = energy.total > 0
    ? ((energy.highCount * 8 + energy.lowCount * 3) / energy.total).toFixed(1)
    : 'N/A';
  output.push(`  平均能量：${avgEnergy}/10`);
  output.push(`  高能量记录：${energy.highCount}次`);
  output.push(`  低能量记录：${energy.lowCount}次`);

  output.push(``);
  output.push(`## 👥 关系网络`);

  if (people.topPeople.length > 0) {
    output.push(`  高频联系人 Top${people.topPeople.length}：`);
    for (const p of people.topPeople) {
      output.push(`  · ${p.name}（${p.count}次）`);
    }
  } else {
    output.push(`  暂无足够数据`);
  }

  output.push(``);
  output.push(`## 🎯 执行力分析`);
  output.push(`  待办总数：${todos.total}`);
  output.push(`  完成率：${todos.completionRate}%`);
  if (todos.overdue > 0) {
    output.push(`  ⚠️ 逾期未完成：${todos.overdue}条`);
  }

  output.push(``);
  output.push(`## 🏃 健康追踪`);
  output.push(`  睡眠相关：${health.sleep}次`);
  output.push(`  运动相关：${health.exercise}次`);
  output.push(`  饮食相关：${health.diet}次`);

  output.push(``);
  output.push(`## 📂 记录分布`);
  for (const [cat, count] of categories) {
    output.push(`  ${cat}：${count}条`);
  }

  output.push(``);
  output.push(`─── 分析于 ${today} ───`);

  return output.join('\n');
}

// CLI
if (require.main === module) {
  console.log(generateProfile());
}

module.exports = { generateProfile, analyzeEmotions, analyzePeople, analyzeTodos };
