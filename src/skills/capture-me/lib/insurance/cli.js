#!/usr/bin/env node
/**
 * lib/insurance/cli.js — 保险管家 CLI
 *
 * add-policy --json '<json>'           录保单
 * add-cash --json '<json>'             录现金资产
 * add-claim --json '<json>'            录理赔
 * query [keyword]                      查保单
 * renewals                             查 60/30/7 天内续保/到期
 * gap --income N --expense N           单独跑缺口分析
 * report --income N --expense N        体检报告（终端 + 落盘）
 * check-reminders                      跑续保/到期提醒（cron 调用）
 * rules-review                         用户偶发：评估规则（v1 stub）
 */
const insurance = require('./index');
const args = process.argv.slice(2);
const [cmd, ...rest] = args;

function usage() {
  console.log(`Usage: node lib/insurance/cli.js <command> [args]

Commands:
  add-policy --json '<json>'           录保单
  add-cash --json '<json>'             录现金资产
  add-claim --json '<json>'            录理赔
  query [keyword]                      查保单
  renewals                             查 60/30/7 天内续保/到期
  gap --income N --expense N           单独跑缺口分析
  report --income N --expense N        体检报告（终端 + 落盘）
  check-reminders                      跑续保/到期提醒（cron 调用）
  rules-review                         用户偶发：评估规则（v1 stub）
`);
}

function readFlag(rest, flag) {
  const idx = rest.indexOf(flag);
  return idx >= 0 ? rest[idx + 1] : null;
}

if (!cmd || cmd === '--help' || cmd === '-h') { usage(); process.exit(0); }

try {
  if (cmd === 'add-policy') {
    const json = readFlag(rest, '--json');
    if (!json) { console.error("Usage: add-policy --json '<json>'"); process.exit(1); }
    const validated = insurance.validateParsedPolicy(JSON.parse(json));
    const healthDisclosure = readFlag(rest, '--health-disclosure');
    const result = insurance.addPolicy(validated, healthDisclosure);
    console.log(`✓ 保单已录入: ${result.policy_id}`);
    console.log(`  投保人/被保人/受益人:`, JSON.stringify(result.memberIds));
    console.log(`  ${result.summary.product_name} | ${result.summary.category}`);
    if (result.summary.sum_insured) console.log(`  保额 ¥${Number(result.summary.sum_insured).toLocaleString('zh-CN')}`);
    if (result.summary.annual_premium) console.log(`  年缴 ¥${Number(result.summary.annual_premium).toLocaleString('zh-CN')}`);
    if (result.summary.next_renewal_date) console.log(`  下次续保: ${result.summary.next_renewal_date}`);
    if (result.summary.sales_contact) {
      const c = result.summary.sales_contact;
      console.log(`  销售: ${c.name || ''} ${c.phone || ''} — 注意保存此联系方式`);
    }
    if (result.summary.health_disclosure) console.log(`  健康告知: ${result.summary.health_disclosure}`);
    console.log('');
    console.log('体检报告: node bin/insurance report --income N --expense N');
  } else if (cmd === 'add-cash') {
    const json = readFlag(rest, '--json');
    if (!json) { console.error("Usage: add-cash --json '<json>'"); process.exit(1); }
    const a = insurance.addCash(JSON.parse(json));
    console.log(`✓ 现金资产已录入: ${a.asset_id}`);
    console.log(`  ${a.type} | ${a.account_alias || ''} | ¥${Number(a.balance).toLocaleString('zh-CN')}`);
  } else if (cmd === 'add-claim') {
    const json = readFlag(rest, '--json');
    if (!json) { console.error("Usage: add-claim --json '<json>'"); process.exit(1); }
    const c = insurance.addClaim(JSON.parse(json));
    console.log(`✓ 理赔已录入: ${c.claim_id} (${c.status})`);
  } else if (cmd === 'query') {
    const kw = rest[0];
    const all = insurance.listPolicies();
    const filtered = kw ? all.filter(p =>
      (p.product_name || '').includes(kw) || (p.insurer || '').includes(kw) || (p.category || '').includes(kw)) : all;
    if (filtered.length === 0) console.log('(无匹配保单)');
    else for (const p of filtered) console.log(`  [${p.policy_id}] ${p.product_name || '(无名)'} | ${p.category} | ¥${p.sum_insured || '?'} | ${p.status}`);
  } else if (cmd === 'renewals') {
    const today = new Date();
    for (const p of insurance.listPolicies()) {
      if (!p.next_renewal_date) continue;
      const days = Math.round((new Date(p.next_renewal_date) - today) / (1000 * 60 * 60 * 24));
      if (days >= 0 && days <= 60) console.log(`  ${p.product_name} | 续保 ${p.next_renewal_date} (${days} 天后) | ${p.annual_premium ? '¥' + Number(p.annual_premium).toLocaleString('zh-CN') : ''}`);
    }
  } else {
    const ctx = {
      annualIncome: Number(readFlag(rest, '--income')) || 0,
      annualExpense: Number(readFlag(rest, '--expense')) || 0,
      mortgageBalance: Number(readFlag(rest, '--mortgage')) || 0,
      occupation: readFlag(rest, '--occupation') || 'office',
      hasGuaranteedRenewable: rest.includes('--guaranteed-renewable'),
      hasStableJob: rest.includes('--stable-job'),
    };
    if (cmd === 'gap') {
      const data = insurance.buildReport(ctx);
      console.log('【缺口分析】');
      if (data.D_gaps.length === 0) console.log('  ✓ 无显著缺口');
      else for (const g of data.D_gaps) console.log(`  · ${g.label}${g.amount ? ' ¥' + g.amount.toLocaleString('zh-CN') : ''}`);
    } else if (cmd === 'report') {
      const data = insurance.buildReport(ctx);
      console.log(insurance.renderTerminal(data));
      const file = insurance.writeMarkdown(data);
      console.log('');
      console.log(`📄 Markdown 落盘: ${file}`);
    } else if (cmd === 'check-reminders') {
      const r = insurance.runReminders();
      if (!r.sent) console.log('(本周无保单到期或续保)');
    } else if (cmd === 'rules-review') {
      console.log('规则评估（v1 stub）：当前规则基于 2026-06 spec，无新反馈需评估。');
      console.log('未来版本会读 policy_check_feedback 表 → 跑 LLM 评估规则覆盖度。');
    } else {
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
    }
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
