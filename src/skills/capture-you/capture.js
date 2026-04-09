#!/usr/bin/env node
/**
 * capture.js — 随手捕捉解析与路由
 * 用法:
 *   node capture.js "<要记的内容>"  # 记录内容
 *   node capture.js init            # 初始化用户画像
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { insertNote } = require('./db');
const { isSetupComplete, getProfile, generateGreeting } = require('./setup');

// 用户数据目录：.claude/skills/capture-you/memory/
// 该目录在 rsync 中被排除，升级时不会被覆盖
const MEMORY_DIR = path.join(__dirname, 'memory');
const CAPTURE_LOG = path.join(MEMORY_DIR, 'capture-log.md');
const PROMISES = path.join(MEMORY_DIR, 'promises.md');

// ─── 时间解析 ────────────────────────────────────────────

function parseDeadline(text) {
  const now = new Date();

  // 本周五 (假设一周从周一开始)
  const dayOfWeek = now.getDay(); // 0=周日, 1=周一...
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;

  const patterns = [
    { regex: /今天/i, fn: () => { const d = new Date(now); d.setHours(20, 0, 0, 0); return d; } },
    { regex: /明天/i, fn: () => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
    { regex: /后天/i, fn: () => { const d = new Date(now); d.setDate(d.getDate() + 2); d.setHours(9, 0, 0, 0); return d; } },
    { regex: /周五/i, fn: () => { const d = new Date(now); d.setDate(d.getDate() + daysUntilFriday); d.setHours(18, 0, 0, 0); return d; } },
    { regex: /下周/i, fn: () => { const d = new Date(now); d.setDate(d.getDate() + 7 - dayOfWeek + 1); d.setHours(9, 0, 0, 0); return d; } },
    { regex: /周末/i, fn: () => { const d = new Date(now); d.setDate(d.getDate() + daysUntilFriday + 2); d.setHours(14, 0, 0, 0); return d; } },
    { regex: /月底/i, fn: () => { const d = new Date(now.getFullYear(), now.getMonth() + 1, 0); d.setHours(18, 0, 0, 0); return d; } },
  ];

  // 判断 "今天" 是否为时间状语（已完成事件）而非截止日期
  // "今天创建了XXX"、"今天完成了XXX" → 时间状语
  // "今天必须完成XXX"、"记得今天给XXX" → 截止日期
  const isTimeAdverb = /今天.{0,6}(?:了|过)/.test(text) && !/(?:必须|要|记得|截止|前)今天/.test(text);

  for (const p of patterns) {
    if (p.regex.test(text)) {
      // "今天" + 完成时标记 → 不是 deadline，是时间状语
      if (p.regex.toString() === '/今天/i' && isTimeAdverb) {
        return { deadline: null, isDeadline: false };
      }
      return { deadline: p.fn(), isDeadline: true };
    }
  }
  return { deadline: null, isDeadline: false };
}

function formatDate(date) {
  if (!date) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ─── 承诺识别 ────────────────────────────────────────────

function isPromise(text) {
  const promisePatterns = [
    /给.{1,10}发/,
    /帮.{1,10}[做准备整理]/,  // 帮李总准备材料、帮张三整理文件
    /替.{1,10}[做搞准备]/,    // 替李总搞
    /答应.{1,20}/,
    /承诺.{1,20}/,
    /要.{1,10}确认/,
    /要.{1,10}发/,
    /记得.{1,20}/,
    /跟进/,
    /催.{1,10}/,
  ];
  return promisePatterns.some(p => p.test(text));
}

function extractPromiseTarget(text) {
  // 提取 "给X" 中的人
  const m = text.match(/给([^发确认做]+)发|帮([^做]+)做|替([^搞]+)搞/);
  if (m) return (m[1] || m[2] || m[3] || '').trim();
  return null;
}

function extractAction(text) {
  // 提取核心动作
  let action = text
    .replace(/下周|明天|周五|记得|要|帮我|给.*?(发|做|确认)/, '')
    .trim();
  return action;
}

// ─── 标签识别 ────────────────────────────────────────────

function inferTags(text) {
  const tags = [];

  // 项目
  if (/意图工作流|intent.?workflow/i.test(text)) tags.push('@project/intent-workflow');
  if (/skill/i.test(text)) tags.push('@idea');

  // 工作
  if (/邮件|email|发.*邮件/i.test(text)) tags.push('@work/email');
  if (/会议|meeting/i.test(text)) tags.push('@work/meeting');
  if (/汇报|report/i.test(text)) tags.push('@work/report');
  if (/跟进|followup/i.test(text)) tags.push('@work/followup');
  if (/工作|job|项目|project/i.test(text) && !tags.some(t => t.startsWith('@project'))) tags.push('@work');

  // 投资
  if (/股票|基金|投资|股/i.test(text)) tags.push('@investment');
  if (/加密|比特币|eth|币/i.test(text)) tags.push('@investment');

  // 生活
  if (/生活|吃饭|医疗|健康/i.test(text)) tags.push('@life');

  // 健康
  if (/睡眠|睡|累|疲惫|没睡好|运动|跑步|健身|身体|健康/i.test(text)) tags.push('@health');

  // 人
  if (/某总|总经|王总|李总/i.test(text)) tags.push('@people/老板');

  // 时间
  const { deadline, isDeadline } = parseDeadline(text);
  if (deadline && isDeadline) {
    const daysUntil = Math.round((deadline - new Date()) / (1000*60*60*24));
    if (daysUntil <= 0) tags.push('@deadline/今天');
    else if (daysUntil === 1) tags.push('@deadline/明天');
    else if (daysUntil <= 7) {
      const dayName = deadline.toLocaleDateString('zh-CN', { weekday: 'long' });
      tags.push(`@deadline/${dayName}`);
    }
    else tags.push('@deadline/本周');
  }

  // 承诺
  if (isPromise(text)) tags.push('@promise');

  // 默认
  if (tags.length === 0) tags.push('@life');

  return tags;
}

// ─── Apple Reminders ────────────────────────────────────

function addToAppleReminders(title, date) {
  if (!date) return null;
  const dateStr = formatDate(date);
  const script = `
    tell application "Reminders"
      set targetList to first list whose name is "提醒"
      make new reminder at end of targetList with properties {name:"${title}", due date:date "${dateStr}"}
    end tell
  `;
  try {
    execSync(`osascript -e '${script}'`, { timeout: 5000 });
    return dateStr;
  } catch (e) {
    // Fallback: just return the date, caller can show it
    return dateStr;
  }
}

// ─── 文件写入 ────────────────────────────────────────────

function appendToCaptureLog(entry) {
  const now = new Date();
  const date = now.toLocaleDateString('zh-CN');
  const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  const formattedEntry = `\n> ${entry.text} — ${entry.tags.join(' ')} — captured at ${time}\n`;

  let content = fs.readFileSync(CAPTURE_LOG, 'utf-8');

  // 找到当天的 section
  const todayHeader = `### ${date}`;
  if (content.includes(todayHeader)) {
    content = content.replace(todayHeader + '\n', todayHeader + '\n' + formattedEntry);
  } else {
    // 插入新日期
    const insertPoint = content.indexOf('\n## ');
    if (insertPoint > 0) {
      content = content.slice(0, insertPoint) + `\n### ${date}\n${formattedEntry}` + content.slice(insertPoint);
    } else {
      content += `\n### ${date}\n${formattedEntry}`;
    }
  }

  fs.writeFileSync(CAPTURE_LOG, content, 'utf-8');
}

function appendToPromises(entry) {
  const now = new Date();
  const weekOf = getWeekOfYear(now);
  const month = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit' });

  const row = `| ${entry.action} | ${entry.target || ''} | ${entry.deadline || ''} | @pending | |\n`;

  // 简化实现：直接在 promises.md 追加
  let content = fs.readFileSync(PROMISES, 'utf-8');

  // 找本周 section
  const weekHeader = `## 本周承诺 (Week of ${now.toISOString().split('T')[0]})`;
  if (!content.includes(weekHeader)) {
    content = content.replace('## 本周承诺 (Week of', `## 本周承诺 (Week of ${now.toISOString().split('T')[0]}\n\n| 承诺内容 | 对象 | 截止 | 状态 | 备注 |\n|----------|------|------|------|------|\n`);
  }

  content = content.replace(
    /(\| 承诺内容 \| 对象 \| 截止 \| 状态 \| 备注 \|\n\|----------\|------\|------\|------\------\|)/,
    `$1\n| ${entry.action} | ${entry.target || ''} | ${entry.deadline ? formatDate(entry.deadline) : ''} | @pending | |`
  );

  fs.writeFileSync(PROMISES, content, 'utf-8');
}

function getWeekOfYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ─── 待办动词检测 ──────────────────────────────────────

function hasTodoVerb(text) {
  const todoPatterns = [
    /要.{1,10}/,      // 要完成、要发、要确认
    /需要.{1,10}/,     // 需要处理
    /必须.{1,10}/,     // 必须完成
    /记得.{1,10}/,     // 记得做
    /应该.{1,10}/,     // 应该处理
    /来得及.{1,10}/,   // 来不及做
    /别忘了.{1,10}/,   // 别忘了发
    /截止.{1,10}/,     // 截止日期
  ];
  return todoPatterns.some(p => p.test(text));
}

// ─── 主解析 ────────────────────────────────────────────

function parse(text) {
  const tags = inferTags(text);
  const { deadline } = parseDeadline(text);
  const action = extractAction(text);
  const target = extractPromiseTarget(text);
  const isPromiseItem = isPromise(text);
  const isTodo = hasTodoVerb(text);

  const result = {
    text,
    tags,
    deadline,
    action,
    target,
    isPromise: isPromiseItem,
    isTodo,
  };

  // 路由决定：只有承诺类或有待办动词的才进入 apple-reminder
  if (deadline && (isPromiseItem || isTodo)) {
    result.route = 'apple-reminder';
    result.reminderDate = addToAppleReminders(text, deadline);
  } else if (isPromiseItem) {
    result.route = 'promises';
  } else {
    result.route = 'capture-log';
  }

  return result;
}

// ─── 输出报告 ────────────────────────────────────────────

function formatReport(r) {
  const lines = [
    `✓ 已捕获`,
    `  内容：「${r.text}」`,
    `  标签：${r.tags.join(' ')}`,
  ];

  if (r.isPromise) {
    lines.push(`  提取承诺：${r.action}`);
    if (r.target) lines.push(`  对象：${r.target}`);
  }

  if (r.route === 'apple-reminder') {
    lines.push(`  → Apple Reminders 已添加提醒`);
    lines.push(`  提醒时间：${r.reminderDate}`);
  } else if (r.route === 'promises') {
    lines.push(`  → promises.md`);
  } else {
    lines.push(`  → capture-log.md`);
  }

  return lines.join('\n');
}

// ─── CLI 入口 ────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  // init 命令：触发交互式引导（--force 强制进入）
  if (subcommand === 'init') {
    const { default: setup } = await import('./setup.js');
    process.argv = ['node', 'setup.js', '--force'];
    await setup.main();
    return;
  }

  const input = args.join(' ');
  if (!input) {
    console.log('用法:');
    console.log('  node capture.js "<要记的内容>"    # 记录内容');
    console.log('  node capture.js init              # 初始化用户画像');
    console.log('  node setup.js                     # 首次使用引导');
    console.log('  node profile.js                   # 查看性格画像');
    process.exit(1);
  }

  // ─── 首次使用检查 ────────────────────────────────────
  if (!isSetupComplete()) {
    console.log('\n✨ 欢迎使用 capture-you！');
    console.log('  首次使用，建议先运行 `node capture.js init` 完成初始化，');
    console.log('  这样我能更好地记住你，提供更个性化的服务。\n');
  } else {
    const profile = getProfile();
    if (profile) {
      console.log(`\n${generateGreeting(profile)}\n`);
    }
  }

  const result = parse(input);
  console.log(formatReport(result));

  // 写入记忆文件
  appendToCaptureLog({
    text: input,
    tags: result.tags,
    action: result.action,
    target: result.target,
    deadline: result.deadline,
  });

  if (result.isPromise) {
    appendToPromises({
      action: result.action,
      target: result.target,
      deadline: result.deadline,
    });
  }

  // 写入 SQLite
  const now = new Date();
  const id = 'capture-' + Date.now();
  try {
    insertNote({
      id,
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().slice(0, 5),
      raw_text: input,
      ai_summary: result.isPromise
        ? `承诺：${result.action}${result.target ? '（对象：' + result.target + '）' : ''}`
        : result.tags.join(' ').replace(/@/g, '').replace(/\//g, '/'),
      category: result.tags.find(t => ['@work', '@life', '@health', '@idea', '@goal', '@investment'].includes(t))?.replace('@', '') || 'life',
      tags: JSON.stringify(result.tags),
      extracted_entities: JSON.stringify({
        people: result.target ? [result.target] : [],
        dates: result.deadline ? [result.deadline.toISOString()] : [],
      }),
      is_todo: result.isTodo,
      todo_due: result.deadline ? result.deadline.toISOString() : null,
      source: 'cli',
    });
  } catch (e) {
    // SQLite 写入失败不阻断主流程
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { parse, formatReport };
