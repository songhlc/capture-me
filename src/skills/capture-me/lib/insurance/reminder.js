/**
 * lib/insurance/reminder.js — 续保/到期提醒
 * buildReminderMessage()  生成单条汇总（命中 7/30/60 任一窗口才返回）
 * runCheckReminders()     CLI 入口：跑一次检查 + notify
 */
const insDb = require('./db');
const { notify } = require('../notify');

const WINDOWS = [
  { days: 7,  label: '7 天内',  includeBankHint: true },
  { days: 30, label: '30 天内', includeBankHint: false },
  { days: 60, label: '60 天内', includeBankHint: false, isExpiry: true },
];

function daysFromNow(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}

function buildReminderMessage() {
  const lines = ['📅 续保/到期提醒\n'];
  let anyHit = false;

  for (const win of WINDOWS) {
    if (win.isExpiry) {
      const expiring = insDb.listPoliciesExpiringSoon(win.days);
      if (expiring.length === 0) continue;
      anyHit = true;
      lines.push(`【${win.label} 到期保单】`);
      for (const p of expiring) {
        const days = daysFromNow(p.end_date);
        lines.push(`• ${p.product_name}`);
        lines.push(`  到期: ${p.end_date} (${days} 天后)`);
        lines.push(`  状态: 即将过期，请确认续保`);
      }
      lines.push('');
    } else {
      const renewing = insDb.listPoliciesRenewingSoon(win.days);
      if (renewing.length === 0) continue;
      anyHit = true;
      lines.push(`【${win.label} 续保保单】`);
      for (const p of renewing) {
        const days = daysFromNow(p.next_renewal_date);
        lines.push(`• ${p.product_name}`);
        lines.push(`  下次缴费: ${p.next_renewal_date} (${days} 天后)`);
        if (p.annual_premium) lines.push(`  ¥${Number(p.annual_premium).toLocaleString('zh-CN')}`);
        if (win.includeBankHint) {
          lines.push(`  ⚠️ **建议提前 3 天确认绑定银行卡余额**（断缴 → 失效）`);
        }
        if (p.sales_contact) {
          const c = typeof p.sales_contact === 'string' ? JSON.parse(p.sales_contact) : p.sales_contact;
          lines.push(`  销售联系: ${c.name || ''} ${c.phone || ''}`);
        }
      }
      lines.push('');
    }
  }

  if (!anyHit) return null;
  lines.push('查看完整保单：/capture-me insurance query');
  lines.push('体检报告：/capture-me insurance report');
  return lines.join('\n');
}

function runCheckReminders() {
  const msg = buildReminderMessage();
  if (!msg) return { sent: false, message: null, reason: 'no_upcoming' };
  notify(msg, { title: '保险管家' });
  return { sent: true, message: msg };
}

module.exports = { buildReminderMessage, runCheckReminders, daysFromNow, WINDOWS };
