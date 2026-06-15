#!/usr/bin/env node
/**
 * bin/dispatch.js — unified cron entry, routes by command name
 * (one plist-friendly shim for both weekplan and insurance)
 */
const cmd = process.argv[2];
if (cmd === 'checkin-bot' || cmd === 'auto-report' || cmd === 'setup') {
  require('../lib/weekplan.js');
} else if (cmd === 'check-reminders') {
  require('../lib/insurance/cli.js');
} else {
  console.error(`dispatch: unknown command ${cmd}`);
  process.exit(1);
}
