#!/usr/bin/env node
/**
 * setup.js — capture-you 首次使用引导
 * 收集用户基本信息，初始化用户画像
 *
 * 对话式 API:
 *   setup.start()              // 开始/继续，返回当前问题
 *   setup.answer(answer)       // 提交答案，返回下一问题或完成
 *   setup.isComplete()         // 检查是否已完成
 *   setup.getProfile()         // 获取当前画像
 *
 * CLI 模式:
 *   node setup.js              // 交互式问答
 *   node setup.js --silent     // 使用默认值
 *   node setup.js --update     // 更新已有信息
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 用户数据目录：.claude/skills/capture-you/memory/
const MEMORY_DIR = path.join(__dirname, 'memory');
const USER_PROFILE = path.join(MEMORY_DIR, 'user-profile.md');

// ─── 对话状态文件 ────────────────────────────────────────────
const STATE_FILE = path.join(MEMORY_DIR, 'setup-state.json');

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
  return null;
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function clearState() {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}

// ─── 问题定义 ────────────────────────────────────────────

const QUESTIONS = [
  {
    key: '称呼',
    question: '你怎么称呼？（可以是名字、昵称，或任何你喜欢的称呼）',
    default: '',
    required: true,
  },
  {
    key: '性别',
    question: '性别？（可选，直接回车跳过）',
    default: '',
    required: false,
  },
  {
    key: '年龄段',
    question: '年龄段？（如：25-30，直接回车跳过）',
    default: '',
    required: false,
  },
  {
    key: '职业/领域',
    question: '你的职业或主要领域？（如：产品经理、投资、开发者）',
    default: '',
    required: false,
  },
  {
    key: '主要场景',
    question: '你主要在什么场景下记录？',
    default: '工作为主',
    required: false,
    options: ['工作为主', '生活为主', '工作生活各半', '学习研究'],
  },
  {
    key: '语言风格',
    question: '你喜欢什么样的回复风格？',
    default: '简洁',
    required: false,
    options: ['简洁', '详细', '活泼', '正式'],
  },
  {
    key: '提醒方式',
    question: '待办提醒你希望怎么收到？',
    default: 'Apple Reminders',
    required: false,
    options: ['Apple Reminders', '仅记录不提醒', '邮件'],
  },
  {
    key: '记录频率',
    question: '你预计多久记录一次？',
    default: '每天几次',
    required: false,
    options: ['每天多次', '每天一次', '几天一次', '想起来才记'],
  },
  {
    key: '长期目标',
    question: '用一句话说说你的长期目标？（让工具更好地理解你）',
    default: '',
    required: false,
  },
  {
    key: '当前重点',
    question: '最近最关心的事是什么？（工作/投资/健康/家庭等）',
    default: '',
    required: false,
  },
];

// ─── 颜色输出 ────────────────────────────────────────────

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(color, ...args) {
  console.log(`${color}${args.join(' ')}${colors.reset}`);
}

function header() {
  console.log('');
  log(colors.cyan, '╔══════════════════════════════════════════════════════╗');
  log(colors.cyan, '║       capture-you ✨ 首次使用引导                   ║');
  log(colors.cyan, '╚══════════════════════════════════════════════════════╝');
  console.log('');
  log(colors.dim, '  让我先了解一下你，这样可以更好地为你服务。');
  log(colors.dim, '  所有信息仅保存在本地，你可以随时修改。\n');
}

function optionLine(options) {
  if (!options) return '';
  return ` （${options.join(' / ')}）`;
}

// ─── 交互式问答 ────────────────────────────────────────────

function askQuestion(rl, q) {
  return new Promise((resolve) => {
    const prompt = `${colors.yellow}?${colors.reset} ${q.bold || q.question}${optionLine(q.options)}${colors.dim} [${q.default || '可直接回车'}]${colors.reset}\n${colors.green}>${colors.reset} `;

    rl.question(prompt, (answer) => {
      const trimmed = answer.trim();
      if (!trimmed && q.default) {
        resolve(q.default);
      } else if (!trimmed && q.required) {
        log(colors.yellow, `  ↳ 此项为必填，请输入：`);
        askQuestion(rl, q).then(resolve);
      } else {
        resolve(trimmed || q.default || '');
      }
    });
  });
}

async function interactiveSetup() {
  header();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answers = {};

  for (const q of QUESTIONS) {
    console.log('');
    answers[q.key] = await askQuestion(rl, q);
  }

  rl.close();
  console.log('');

  return answers;
}

// ─── 配置文件更新 ────────────────────────────────────────────

function updateProfile(answers) {
  const today = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().slice(0, 5);

  // 读取现有模板
  let content = fs.readFileSync(USER_PROFILE, 'utf-8');

  // 更新基本信息
  for (const [key, value] of Object.entries(answers)) {
    // 匹配表格行并替换
    const rowRegex = new RegExp(`(\\| ${key} \\| )[^|]*(\\| )[^|]*(\\|)`);
    if (rowRegex.test(content)) {
      content = content.replace(rowRegex, `$1${value}$2${today} $time$3`);
    }
  }

  // 更新目标与关注点
  if (answers['长期目标']) {
    content = content.replace(
      /(- \*\*长期目标\*\*：)[^]*/,
      `$1${answers['长期目标']}`
    );
  }
  if (answers['当前重点']) {
    content = content.replace(
      /(- \*\*当前重点\*\*：)[^]*/,
      `$1${answers['当前重点']}`
    );
  }

  fs.writeFileSync(USER_PROFILE, content, 'utf-8');
}

function initProfile(answers) {
  const today = new Date().toISOString().split('T')[0];

  const content = `---
name: user-profile
description: 用户基本信息与画像初始化
type: user
---

# 用户画像 v1.0

> 由 setup.js 初始化，最后更新于 ${today}

## 基本信息

| 字段 | 值 | 更新时间 |
|------|----|----------|
| 称呼 | ${answers['称呼'] || ''} | ${today} |
| 性别 | ${answers['性别'] || ''} | ${today} |
| 年龄段 | ${answers['年龄段'] || ''} | ${today} |
| 职业/领域 | ${answers['职业/领域'] || ''} | ${today} |
| 主要场景 | ${answers['主要场景'] || ''} | ${today} |
| 时区 | Asia/Shanghai | ${today} |
| 记录频率 | ${answers['记录频率'] || ''} | ${today} |

## 个人偏好

| 偏好项 | 值 | 说明 |
|--------|----|------|
| 语言风格 | ${answers['语言风格'] || '简洁'} | 简洁/详细/活泼/正式 |
| 提醒方式 | ${answers['提醒方式'] || 'Apple Reminders'} | Apple Reminders/邮件/不提醒 |
| 周报格式 | 简洁 | 简洁/详细 |
| 标签风格 | 简单 | 简单/精细 |

## 目标与关注点

- **长期目标**：${answers['长期目标'] || ''}
- **当前重点**：${answers['当前重点'] || ''}
- **希望工具记住的偏好**：

## 首次使用

- 初始化日期：${today}
- 引导版本：v1.0

---

*此文件由 capture-you skill 自动维护*
`;

  fs.writeFileSync(USER_PROFILE, content, 'utf-8');
}

// ─── 检查是否已完成设置 ────────────────────────────────────

function isSetupComplete() {
  if (!fs.existsSync(USER_PROFILE)) return false;

  const content = fs.readFileSync(USER_PROFILE, 'utf-8');
  // setup.js 初始化过的文件会包含 "capture-you skill" 或 "初始化日期"
  // 但如果称呼为空说明是空模板，仍需完成
  const hasMarker = content.includes('capture-you') || content.includes('初始化日期');
  const profile = getProfile();
  const hasName = profile && profile['称呼'] && profile['称呼'].trim() !== '';

  return hasMarker && hasName;
}

function getProfile() {
  if (!fs.existsSync(USER_PROFILE)) return null;

  const content = fs.readFileSync(USER_PROFILE, 'utf-8');
  const profile = {};

  const rows = [
    '称呼', '性别', '年龄段', '职业/领域', '主要场景', '时区', '记录频率'
  ];

  for (const key of rows) {
    const regex = new RegExp(`\\|\\s*${key}\\s*\\|\\s*([^|]+)\\s*\\|`);
    const match = content.match(regex);
    if (match) profile[key] = match[1].trim();
  }

  // 偏好
  const prefRows = ['语言风格', '提醒方式', '周报格式', '标签风格'];
  profile.preferences = {};
  for (const key of prefRows) {
    const regex = new RegExp(`\\|\\s*${key}\\s*\\|\\s*([^|]+)\\s*\\|`);
    const match = content.match(regex);
    if (match) profile.preferences[key] = match[1].trim();
  }

  // 目标
  const goalMatch = content.match(/\*\*长期目标\*\*：[^\n]*/);
  if (goalMatch) profile['长期目标'] = goalMatch[0].replace('**长期目标**：', '').trim();

  const focusMatch = content.match(/\*\*当前重点\*\*：[^\n]*/);
  if (focusMatch) profile['当前重点'] = focusMatch[0].replace('**当前重点**：', '').trim();

  return profile;
}

// ─── 对话式 API ────────────────────────────────────────────

/**
 * 开始或继续初始化对话
 * @returns {object} { done: false, question: {...}, progress: { current, total }, state: {...} }
 *           或 { done: true, profile: {...} }
 */
function start() {
  // 已完成的检查
  if (isSetupComplete()) {
    return { done: true, profile: getProfile(), message: '已完成初始化' };
  }

  // 加载或初始化状态
  let state = loadState();
  if (!state) {
    state = { currentIndex: 0, answers: {} };
    saveState(state);
  }

  const currentIndex = state.currentIndex;
  const total = QUESTIONS.length;

  if (currentIndex >= total) {
    // 所有问题已答完，写入文件
    initProfile(state.answers);
    clearState();
    return { done: true, profile: getProfile(), message: '初始化完成' };
  }

  const question = QUESTIONS[currentIndex];

  return {
    done: false,
    progress: { current: currentIndex + 1, total },
    question: {
      key: question.key,
      text: question.question,
      options: question.options || null,
      default: question.default || null,
      required: question.required || false,
    },
    state: {
      currentIndex,
      answeredCount: Object.keys(state.answers).length,
    },
  };
}

/**
 * 提交答案
 * @param {string} answer 用户答案
 * @param {string} answerKey 要回答的问题 key（可选，验证一致性）
 * @returns {object} 下一问题或完成状态
 */
function answer(answerText, answerKey = null) {
  const state = loadState();
  if (!state) {
    return { error: '无进行中的对话，请先调用 start()' };
  }

  const currentIndex = state.currentIndex;
  const question = QUESTIONS[currentIndex];

  // 验证 key
  if (answerKey && question.key !== answerKey) {
    return { error: `问题不匹配，期望 ${question.key}，收到 ${answerKey}` };
  }

  const trimmed = (answerText || '').trim();
  let finalAnswer = trimmed || question.default || '';

  // 必填项验证
  if (!finalAnswer && question.required) {
    return { error: '此项为必填，请输入答案' };
  }

  // 保存答案
  state.answers[question.key] = finalAnswer;
  state.currentIndex++;
  saveState(state);

  // 检查是否完成
  if (state.currentIndex >= QUESTIONS.length) {
    initProfile(state.answers);
    clearState();
    return { done: true, profile: getProfile(), message: '初始化完成！' };
  }

  // 返回下一问题
  const nextQuestion = QUESTIONS[state.currentIndex];
  return {
    done: false,
    progress: { current: state.currentIndex + 1, total: QUESTIONS.length },
    question: {
      key: nextQuestion.key,
      text: nextQuestion.question,
      options: nextQuestion.options || null,
      default: nextQuestion.default || null,
      required: nextQuestion.required || false,
    },
  };
}

/**
 * 获取当前状态（不推进）
 */
function getState() {
  const state = loadState();
  if (!state) {
    return { inProgress: false };
  }
  return {
    inProgress: true,
    progress: { current: state.currentIndex + 1, total: QUESTIONS.length },
    answeredCount: Object.keys(state.answers).length,
  };
}

/**
 * 取消对话
 */
function cancel() {
  clearState();
  return { cancelled: true };
}

// ─── 问候语生成 ────────────────────────────────────────────

function generateGreeting(profile) {
  const hour = new Date().getHours();
  const name = profile?.['称呼'];

  let timeGreeting;
  if (hour < 6) timeGreeting = '夜深了';
  else if (hour < 9) timeGreeting = '早上好';
  else if (hour < 12) timeGreeting = '上午好';
  else if (hour < 14) timeGreeting = '中午好';
  else if (hour < 18) timeGreeting = '下午好';
  else if (hour < 22) timeGreeting = '晚上好';
  else timeGreeting = '夜深了';

  if (name) {
    return `${timeGreeting}，${name}！`;
  }
  return `${timeGreeting}！`;
}

// ─── CLI ────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--silent')) {
    // 静默模式：使用默认值
    const answers = {};
    for (const q of QUESTIONS) {
      answers[q.key] = q.default || '';
    }
    initProfile(answers);
    log(colors.green, '✓ 使用默认配置完成初始化');
    return;
  }

  if (args.includes('--update')) {
    // 更新模式：只问必填和重要的
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    log(colors.blue, '\n📝 更新用户信息（直接回车保留现有值）\n');

    const importantFields = ['称呼', '职业/领域', '当前重点', '长期目标'];
    const current = getProfile() || {};

    const answers = { ...current };

    for (const key of importantFields) {
      const q = QUESTIONS.find(q => q.key === key);
      if (!q) continue;

      const currentVal = current[key] || '';
      const prompt = `${colors.yellow}?${colors.reset} ${q.question}${colors.dim} [${currentVal || '无'}]${colors.reset}\n${colors.green}>${colors.reset} `;

      const answer = await new Promise((resolve) => {
        rl.question(prompt, (a) => resolve(a.trim()));
      });

      if (answer) answers[key] = answer;
    }

    rl.close();
    updateProfile(answers);
    log(colors.green, '✓ 信息已更新');
    return;
  }

  // 检查是否已完成设置（--force 时跳过）
  if (!args.includes('--force') && isSetupComplete()) {
    const profile = getProfile();
    log(colors.green, `✓ 你已完成初始化设置`);
    log(colors.dim, `  称呼：${profile?.['称呼'] || '未知'}`);
    log(colors.dim, `  职业：${profile?.['职业/领域'] || '未知'}`);
    console.log('');
    log(colors.blue, `  运行 ${colors.reset}node setup.js --update${colors.blue} 更新信息`);
    return;
  }

  // 首次设置
  const answers = await interactiveSetup();
  initProfile(answers);

  console.log('');
  log(colors.green, '╔══════════════════════════════════════════════════════╗');
  log(colors.green, '║  ✓ 设置完成！感谢你，%s               ║', answers['称呼'] || '');
  log(colors.green, '╚══════════════════════════════════════════════════════╝');
  console.log('');
  log(colors.dim, `  称呼：${answers['称呼'] || '未设置'}`);
  log(colors.dim, `  职业：${answers['职业/领域'] || '未设置'}`);
  log(colors.dim, `  主要场景：${answers['主要场景'] || '未设置'}`);
  console.log('');
  log(colors.cyan, '  现在可以开始使用 capture-you 了！');
  log(colors.cyan, '  运行 `node capture.js "<内容>"` 开始记录。\n');
}

// 只有直接运行 setup.js 时才自动执行，require 时不执行
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  main,
  isSetupComplete,
  getProfile,
  generateGreeting,
  QUESTIONS,
  // 对话式 API
  setup: { start, answer, getState, cancel },
};
