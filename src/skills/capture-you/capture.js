#!/usr/bin/env node
/**
 * capture.js — 随手捕捉存储
 *
 * 设计原则：
 * - 本文件只负责接收原始输入和存储
 * - 解析工作由大模型在对话上下文中完成
 * - 存储后输出结构化指令，让大模型知道如何补充解析
 */

const fs = require('fs');
const path = require('path');
const { insertNote } = require('./db');
const { isSetupComplete, getProfile, generateGreeting, setup } = require('./setup');
const { checkAndNotify } = require('./achievements');

// 用户数据目录
const MEMORY_DIR = path.join(__dirname, 'memory');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const CAPTURE_LOG = path.join(MEMORY_DIR, 'capture-log.md');
const PROMISES = path.join(MEMORY_DIR, 'promises.md');

// ─── 确保内存文件存在 ────────────────────────────────────

function ensureMemoryFiles() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
  if (!fs.existsSync(CAPTURE_LOG)) {
    const template = path.join(TEMPLATES_DIR, 'capture-log.md');
    if (fs.existsSync(template)) {
      fs.copyFileSync(template, CAPTURE_LOG);
    }
  }
  if (!fs.existsSync(PROMISES)) {
    const template = path.join(TEMPLATES_DIR, 'promises.md');
    if (fs.existsSync(template)) {
      fs.copyFileSync(template, PROMISES);
    }
  }
}

function formatDate(date) {
  if (!date) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ─── 存储函数 ────────────────────────────────────────────

function appendToCaptureLog(entry) {
  ensureMemoryFiles();
  const now = new Date();
  const date = now.toLocaleDateString('zh-CN');
  const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  const formattedEntry = `\n> ${entry.text} — ${entry.tags ? entry.tags.join(' ') : ''} — captured at ${time}\n`;

  let content = fs.readFileSync(CAPTURE_LOG, 'utf-8');

  const todayHeader = `### ${date}`;
  if (content.includes(todayHeader)) {
    content = content.replace(todayHeader + '\n', todayHeader + '\n' + formattedEntry);
  } else {
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
  ensureMemoryFiles();
  const now = new Date();

  let content = fs.readFileSync(PROMISES, 'utf-8');

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

// ─── 主捕获函数 ────────────────────────────────────────────

/**
 * 存储原始记录
 * 解析工作由大模型在上下文中完成
 */
function capture(rawText) {
  const now = new Date();
  const id = 'capture-' + Date.now();

  // 基础标签（可由大模型后续补充）
  const defaultTags = ['@capture'];

  // 生成存储对象
  const note = {
    id,
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().slice(0, 5),
    raw_text: rawText,
    ai_summary: null,  // 大模型补充
    category: null,     // 大模型判断
    tags: JSON.stringify(defaultTags),
    extracted_entities: JSON.stringify({}),  // 大模型补充
    is_todo: false,
    todo_due: null,
    todo_done: false,
    source: 'cli',
  };

  // 写入 SQLite
  try {
    insertNote(note);
  } catch (e) {
    console.error('SQLite 写入失败:', e.message);
  }

  // 写入 Markdown
  appendToCaptureLog({
    text: rawText,
    tags: defaultTags,
  });

  return {
    id,
    raw_text: rawText,
    stored: true,
  };
}

// ─── 输出解析指令 ─────────────────────────────────────────

/**
 * 输出结构化指令，让大模型知道如何解析
 * 这些指令会被大模型看到并处理
 */
function outputParseInstructions(rawText, noteId) {
  const instructions = `
\`\`\`json
{
  "action": "parse_capture",
  "note_id": "${noteId}",
  "raw_text": ${JSON.stringify(rawText)},
  "extract": {
    "summary": "一句话摘要",
    "category": "work|life|health|idea|goal|investment",
    "tags": ["@work", "@people/张总", "@deadline/周五"],
    "entities": {
      "people": ["张总"],
      "emails": ["zhang@company.com"],
      "amounts": ["50万"],
      "locations": ["国贸"],
      "times": ["下周一", "14:30"]
    },
    "is_todo": true,
    "todo_due": "2026-04-15",
    "intent": "promise|record|query|review"
  }
}
\`\`\`

请分析以上记录，提取结构化信息。直接回复 JSON 格式的解析结果。`;

  return instructions;
}

// ─── CLI 入口 ────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  // init 命令
  if (subcommand === 'init') {
    const result = setup.start();

    if (result.done) {
      console.log(`\n✓ 你已完成初始化设置`);
      console.log(`  称呼：${result.profile?.['称呼'] || '未知'}`);
      console.log(`  职业：${result.profile?.['职业/领域'] || '未知'}`);
      return;
    }

    const { question, progress } = result;
    const optionsText = question.options ? ` （${question.options.join(' / ')}）` : '';
    const defaultText = question.default ? `[${question.default}]` : '[直接回车跳过]';

    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║       知己 ✨ 初始化引导                              ║`);
    console.log(`╚══════════════════════════════════════════════════════╝`);
    console.log(`\n  第 ${progress.current}/${progress.total} 题\n`);
    console.log(`  ${question.text}${optionsText}`);
    console.log(`  ${defaultText}`);
    console.log(`\n  请回复你的答案。\n`);
    return;
  }

  // answer 命令
  if (subcommand === 'answer') {
    const answerText = args.slice(1).join(' ');
    const result = setup.answer(answerText);

    if (result.error) {
      console.log(`\n⚠️ ${result.error}\n`);
      return;
    }

    if (result.done) {
      console.log(`\n✓ 初始化完成！`);
      console.log(`  称呼：${result.profile?.['称呼'] || '未设置'}\n`);
      return;
    }

    const { question, progress } = result;
    const optionsText = question.options ? ` （${question.options.join(' / ')}）` : '';
    const defaultText = question.default ? `[${question.default}]` : '[直接回车跳过]';

    console.log(`\n  第 ${progress.current}/${progress.total} 题\n`);
    console.log(`  ${question.text}${optionsText}`);
    console.log(`  ${defaultText}`);
    console.log(`\n  请回复你的答案。\n`);
    return;
  }

  // cancel 命令
  if (subcommand === 'cancel') {
    setup.cancel();
    console.log(`\n✓ 已取消初始化\n`);
    return;
  }

  // 收集输入
  const input = args.join(' ');
  if (!input) {
    console.log('用法:');
    console.log('  /capture-you <内容>    # 记录内容');
    console.log('  /capture-you init      # 初始化');
    console.log('  /capture-you profile   # 查看画像');
    console.log('  /capture-you stat     # 查看统计');
    console.log('  /capture-you review   # 生成复盘');
    return;
  }

  // 首次使用检查
  if (!isSetupComplete()) {
    console.log('\n✨ 欢迎使用知己！');
    console.log('  首次使用，建议先运行 `/capture-you init` 完成初始化\n');
  } else {
    const profile = getProfile();
    if (profile) {
      console.log(`\n${generateGreeting(profile)}\n`);
    }
  }

  // 存储原始记录
  const result = capture(input);

  // 输出确认
  console.log(`✓ 已捕获`);
  console.log(`  内容：「${input}」`);
  console.log(`  ID：${result.id}`);
  console.log();

  // 检查成就
  const achNotify = checkAndNotify();
  if (achNotify) console.log(achNotify);

  // 输出解析指令（让大模型知道如何处理）
  console.log(outputParseInstructions(input, result.id));
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { capture, outputParseInstructions };
