/**
 * notify.js — 零配置通知抽象层
 *
 * 探测优先级（高 → 低）：
 *   1. $WEEKPLAN_NOTIFY_CMD     用户/Agent 注入的命令模板（含 {msg} 占位）
 *   2. $OPENCLAW_NOTIFY_CMD     OpenClaw 平台注入
 *   3. $HERMES_NOTIFY_CMD       Hermes 平台注入
 *   4. PATH 中的 openclaw       约定调用 `openclaw notify <msg>`
 *   5. PATH 中的 hermes         约定调用 `hermes notify <msg>`
 *   6. terminal-notifier        macOS 通知
 *   7. osascript (macOS)        系统通知
 *   8. stdout                   兜底
 *
 * 用法：
 *   const { notify } = require('./notify');
 *   notify('本周计划提醒...', { title: 'weekplan' });
 *
 * 测试模式：
 *   WEEKPLAN_DRY_RUN=1  不真发，打印 [DRY] 行（用于测试 / 验证通道）
 */

const { execSync } = require('child_process');

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function which(bin) {
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 探测当前可用的通知通道。
 * @returns {{ kind: string, source: string, tpl?: string, bin?: string }}
 */
function detectChannel() {
  const envTpl =
    process.env.WEEKPLAN_NOTIFY_CMD ||
    process.env.OPENCLAW_NOTIFY_CMD ||
    process.env.HERMES_NOTIFY_CMD;
  if (envTpl) return { kind: 'tpl', tpl: envTpl, source: 'env' };

  for (const bin of ['openclaw', 'hermes']) {
    if (which(bin)) return { kind: 'agent', bin, source: 'path' };
  }

  if (which('terminal-notifier')) return { kind: 'terminal-notifier', source: 'macos' };
  if (process.platform === 'darwin') return { kind: 'osascript', source: 'macos' };

  return { kind: 'stdout', source: 'fallback' };
}

/**
 * 发送一条通知。
 * @param {string} msg
 * @param {{ title?: string, channel?: object }} opts
 * @returns {{ kind: string, source: string, sent: boolean, error?: string }}
 */
function notify(msg, opts = {}) {
  const ch = opts.channel || detectChannel();
  const title = opts.title || 'weekplan';

  if (process.env.WEEKPLAN_DRY_RUN === '1') {
    console.log(`[DRY] via ${ch.kind} (${ch.source}): ${title} | ${msg.split('\n')[0]}`);
    return { ...ch, sent: false };
  }

  try {
    switch (ch.kind) {
      case 'tpl':
        execSync(ch.tpl.replace('{msg}', shellQuote(msg)), { stdio: 'inherit' });
        break;
      case 'agent':
        execSync(`${ch.bin} notify ${shellQuote(msg)}`, { stdio: 'inherit' });
        break;
      case 'terminal-notifier':
        execSync(
          `terminal-notifier -title ${shellQuote(title)} -message ${shellQuote(msg)}`,
          { stdio: 'ignore' }
        );
        break;
      case 'osascript': {
        const escaped = msg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const titleEsc = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        execSync(
          `osascript -e 'display notification "${escaped}" with title "${titleEsc}"'`,
          { stdio: 'ignore' }
        );
        break;
      }
      case 'stdout':
      default:
        process.stdout.write(`[${title}] ${msg}\n`);
    }
    return { ...ch, sent: true };
  } catch (e) {
    process.stdout.write(`[${title}] ${msg}\n(notify via ${ch.kind} failed: ${e.message})\n`);
    return { ...ch, sent: false, error: e.message };
  }
}

module.exports = { notify, detectChannel, _which: which, _shellQuote: shellQuote };

// CLI: node lib/notify.js "msg"
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--detect') {
    console.log(JSON.stringify(detectChannel(), null, 2));
    process.exit(0);
  }
  const msg = args.join(' ') || 'weekplan: hello from notify.js';
  const r = notify(msg);
  console.log(JSON.stringify(r, null, 2));
}
