#!/usr/bin/env node
/**
 * bin/dispatch.js — unified cron entry, routes by command name
 * (one plist-friendly shim for weekplan / insurance / progress-confirm)
 */
const cmd = process.argv[2];
if (cmd === 'checkin-bot' || cmd === 'auto-report' || cmd === 'setup') {
  require('../lib/weekplan.js');
} else if (cmd === 'check-reminders') {
  require('../lib/insurance/cli.js');
} else if (cmd === 'weekly-progress-confirm') {
  // 周度进展确认的 cron 入口
  // 实际触发由 OpenClaw agent turn 编排（不走 launchd）
  // 这里作为占位记录，让 setup-cron.js 可以注册
  console.log('weekly-progress-confirm: please trigger via OpenClaw agent turn');
  console.log('capture-me 提供子命令: capture-me progress-confirm scan/parse/apply');
  process.exit(0);
} else {
  console.error(`dispatch: unknown command ${cmd}`);
  process.exit(1);
}
