/**
 * setup-cron.js — macOS launchd 注册/卸载/状态查询
 *
 * 三个定时任务：
 *   1. 周一 09:00         → checkin-bot --remind-create --send
 *   2. 工作日 18:00        → checkin-bot --remind-update --send
 *   3. 周五 17:30          → auto-report --send
 *
 * launchd Weekday: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 0/7=Sun
 *
 * 测试模式：
 *   SETUP_CRON_DRY_RUN=1   不调 launchctl，只写 plist 到 $SETUP_CRON_PLIST_DIR
 *   SETUP_CRON_PLIST_DIR   覆盖 plist 目录（测试用）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const LABEL_PREFIX = 'me.capture.weekplan';
const HOME = os.homedir();
const DEFAULT_PLIST_DIR = path.join(HOME, 'Library/LaunchAgents');
const LOG_DIR = path.join(HOME, '.claude/skills/capture-me/logs');
const WEEKPLAN_JS = path.resolve(__dirname, 'weekplan.js');
const NODE_BIN = process.execPath;

function plistDir() {
  return process.env.SETUP_CRON_PLIST_DIR || DEFAULT_PLIST_DIR;
}

function isDryRun() {
  return process.env.SETUP_CRON_DRY_RUN === '1';
}

const TASKS = [
  {
    label: `${LABEL_PREFIX}.monday-create`,
    desc: '周一 09:00 提醒创建本周计划',
    args: ['checkin-bot', '--remind-create', '--send'],
    schedule: [{ Weekday: 1, Hour: 9, Minute: 0 }],
  },
  {
    label: `${LABEL_PREFIX}.daily-checkin`,
    desc: '工作日 18:00 提醒补齐进展',
    args: ['checkin-bot', '--remind-update', '--send'],
    schedule: [1, 2, 3, 4, 5].map((d) => ({ Weekday: d, Hour: 18, Minute: 0 })),
  },
  {
    label: `${LABEL_PREFIX}.friday-report`,
    desc: '周五 17:30 自动生成本周周报',
    args: ['auto-report', '--send'],
    schedule: [{ Weekday: 5, Hour: 17, Minute: 30 }],
  },
];

function calXml(cal) {
  return [
    '    <dict>',
    `      <key>Weekday</key><integer>${cal.Weekday}</integer>`,
    `      <key>Hour</key><integer>${cal.Hour}</integer>`,
    `      <key>Minute</key><integer>${cal.Minute}</integer>`,
    '    </dict>',
  ].join('\n');
}

function plistFor(task) {
  const argXml = [NODE_BIN, WEEKPLAN_JS, ...task.args]
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join('\n');

  let intervalXml;
  if (task.schedule.length === 1) {
    intervalXml =
      '  <key>StartCalendarInterval</key>\n' +
      '  <dict>\n' +
      `    <key>Weekday</key><integer>${task.schedule[0].Weekday}</integer>\n` +
      `    <key>Hour</key><integer>${task.schedule[0].Hour}</integer>\n` +
      `    <key>Minute</key><integer>${task.schedule[0].Minute}</integer>\n` +
      '  </dict>';
  } else {
    intervalXml =
      '  <key>StartCalendarInterval</key>\n' +
      '  <array>\n' +
      task.schedule.map(calXml).join('\n') +
      '\n  </array>';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${task.label}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
${intervalXml}
  <key>StandardOutPath</key>
  <string>${path.join(LOG_DIR, task.label + '.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(LOG_DIR, task.label + '.err')}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pathOf(task) {
  return path.join(plistDir(), `${task.label}.plist`);
}

function install() {
  fs.mkdirSync(plistDir(), { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const results = [];
  for (const task of TASKS) {
    const p = pathOf(task);
    fs.writeFileSync(p, plistFor(task));
    if (!isDryRun()) {
      try {
        execSync(`launchctl unload "${p}"`, { stdio: 'ignore' });
      } catch (_) { /* not loaded yet */ }
      try {
        execSync(`launchctl load "${p}"`, { stdio: 'ignore' });
        results.push({ label: task.label, ok: true });
      } catch (e) {
        results.push({ label: task.label, ok: false, error: e.message });
      }
    } else {
      results.push({ label: task.label, ok: true, dryRun: true });
    }
  }
  return results;
}

function uninstall() {
  const results = [];
  for (const task of TASKS) {
    const p = pathOf(task);
    let removed = false;
    if (!isDryRun()) {
      try {
        execSync(`launchctl unload "${p}"`, { stdio: 'ignore' });
      } catch (_) { /* might not be loaded */ }
    }
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed = true;
    }
    results.push({ label: task.label, removed });
  }
  return results;
}

/**
 * 检查 3 个 plist 是否都已注册。
 * @returns {{ ok: boolean, missing: string[], present: string[], tasks: object[] }}
 */
function check() {
  const missing = [];
  const present = [];
  for (const task of TASKS) {
    if (fs.existsSync(pathOf(task))) present.push(task.label);
    else missing.push(task.label);
  }
  return { ok: missing.length === 0, missing, present, tasks: TASKS };
}

module.exports = { install, uninstall, check, TASKS, _plistFor: plistFor, _pathOf: pathOf };
