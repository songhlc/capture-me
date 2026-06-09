#!/usr/bin/env node
/**
 * weekplan.js — Week Plan 业务逻辑 + CLI 入口
 *
 * 设计：
 * - 本文件既是被 lib/ 引用的库，也是 CLI 入口（if (require.main === module)）
 * - PR1 不接外部通道；check-in 由用户通过 CLI 或 LLM 在 capture-me 会话中调用本文件触发
 */

const db = require('./db');
const { getIsoWeek, getWeekBounds } = require('./iso-week');

/**
 * 获取或创建当前 ISO 周的 plan。
 * - 已有同 week_iso 的 plan：返回它
 * - 没有：创建 status=planning 的新 plan
 * @returns {object} week_plans row
 */
function getOrCreateCurrentWeekPlan() {
  const now = new Date();
  const { year, weekNum, weekIso } = getIsoWeek(now);
  const { startDate, endDate } = getWeekBounds(year, weekNum);

  const existing = db.getWeekPlanByIso(weekIso);
  if (existing) return existing;

  const id = `wp_${year}_w${String(weekNum).padStart(2, '0')}`;
  db.insertWeekPlan({
    id,
    week_iso: weekIso,
    year,
    week_num: weekNum,
    start_date: startDate,
    end_date: endDate,
    status: 'planning',
  });
  return db.getWeekPlan(id);
}

/**
 * 读取当前 ISO 周的 plan（不创建）。
 * @returns {object|undefined}
 */
function getCurrentWeekPlan() {
  const now = new Date();
  const { weekIso } = getIsoWeek(now);
  return db.getWeekPlanByIso(weekIso);
}

/**
 * 向 plan 添加一项计划。
 * @param {string} planId
 * @param {object} item - { title, description?, project?, priority?, assignee?, expected_outcome? }
 * @returns {string} item id
 */
function addItem(planId, item) {
  const existing = db.getWeekPlanItems(planId);
  return db.insertWeekPlanItem({
    ...item,
    plan_id: planId,
    sort_order: existing.length,
  });
}

/**
 * 读取 plan + 其所有 items 的完整对象。
 * @param {string} planId
 * @returns {{plan: object, items: object[]}|null}
 */
function getPlanWithItems(planId) {
  const plan = db.getWeekPlan(planId);
  if (!plan) return null;
  const items = db.getWeekPlanItems(planId);
  return { plan, items };
}

/**
 * 记录一次 check-in 更新。
 * - 写入 week_plan_updates（不可变历史）
 * - 同步更新 week_plan_items.status 到最新
 * @param {object} args - { item_id, plan_id, status_after, progress_note?, source? }
 * @returns {string} update id
 */
function checkinItem(args) {
  const today = new Date().toISOString().split('T')[0];
  return db.insertWeekPlanUpdate({
    item_id: args.item_id,
    plan_id: args.plan_id,
    update_date: today,
    status_after: args.status_after,
    progress_note: args.progress_note || null,
    source: args.source || 'cli',
  });
}

const STATUS_EMOJI = {
  pending: '⏳',
  partial: '🟡',
  done: '✅',
  blocked: '⛔',
};

/**
 * 把 plan 渲染成可读的文本（终端展示用）。
 * @param {string} planId
 * @returns {string}
 */
function renderPlan(planId) {
  const data = getPlanWithItems(planId);
  if (!data) return `(plan ${planId} not found)`;
  const { plan, items } = data;
  const lines = [];
  lines.push(`📋 Week Plan — ${plan.week_iso}`);
  lines.push(`${plan.start_date} ~ ${plan.end_date}  [${plan.status}]`);
  lines.push('');
  if (items.length === 0) {
    lines.push('(no items yet)');
  } else {
    items.forEach((it, i) => {
      const emoji = STATUS_EMOJI[it.status] || '·';
      const pri = it.priority ? ` (${it.priority})` : '';
      const who = it.assignee && it.assignee !== '我' ? ` — ${it.assignee}` : '';
      lines.push(`  ${emoji} ${i + 1}. ${it.title}${pri}${who}`);
    });
  }
  return lines.join('\n');
}

/**
 * 生成"今日 plan check-in"消息（bot 推送的文本）。
 * @param {string} planId
 * @returns {string}
 */
function generateCheckinMessage(planId) {
  const data = getPlanWithItems(planId);
  if (!data) return `(plan ${planId} not found)`;
  const { plan, items } = data;
  if (items.length === 0) return `(no items to check in for ${plan.week_iso})`;

  const lines = [];
  lines.push(`🌆 今日 plan check-in — ${plan.week_iso}`);
  lines.push(`本周 ${items.length} 项：`);
  items.forEach((it, i) => {
    const emoji = STATUS_EMOJI[it.status] || '·';
    const pri = it.priority ? ` (${it.priority})` : '';
    const status = ` — 状态：${it.status}`;
    lines.push(`${i + 1}. ${it.title}${pri}${emoji}${status}`);
  });
  lines.push('');
  lines.push('回复如：');
  lines.push("  - '1 完成 2 进展 60% 3 阻塞 等张总反馈'");
  lines.push('  - 或逐项说');
  return lines.join('\n');
}

/**
 * 获取或创建指定 ISO 周的 plan（用于测试和 carryover）。
 * @param {number} year
 * @param {number} weekNum
 * @returns {object} week_plans row
 */
function getOrCreateWeekPlan(year, weekNum) {
  const weekIso = `${year}-W${String(weekNum).padStart(2, '0')}`;
  const { startDate, endDate } = getWeekBounds(year, weekNum);
  const existing = db.getWeekPlanByIso(weekIso);
  if (existing) return existing;
  const id = `wp_${year}_w${String(weekNum).padStart(2, '0')}`;
  db.insertWeekPlan({
    id,
    week_iso: weekIso,
    year,
    week_num: weekNum,
    start_date: startDate,
    end_date: endDate,
    status: 'planning',
  });
  return db.getWeekPlan(id);
}

/**
 * 从上一周（year/weekNum-1）复制未完成的 item 到本周 plan。
 * - 只复制 status IN (pending, partial, blocked) 的项
 * - 创建新的 item id（不复用旧的，便于独立更新）
 * - 新 item 的 status 重置为 'pending'
 * - 继承 title/description/project/priority/assignee/expected_outcome
 * @param {number} currentYear
 * @param {number} currentWeekNum
 * @returns {number} 复制的 item 数量
 */
function carryoverFromLastWeek(currentYear, currentWeekNum) {
  // Compute last week's (year, weekNum)
  const { getNextWeekBounds } = require('./iso-week');
  // Use bounds of current week, then subtract 7 days to get last week
  const cur = getWeekBounds(currentYear, currentWeekNum);
  const lastMonday = new Date(cur.startDate + 'T00:00:00Z');
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
  const last = getIsoWeek(lastMonday);

  const lastPlan = db.getWeekPlanByIso(last.weekIso);
  if (!lastPlan) return 0;

  const lastItems = db.getWeekPlanItems(lastPlan.id);
  const unfinished = lastItems.filter((it) =>
    ['pending', 'partial', 'blocked'].includes(it.status)
  );
  if (unfinished.length === 0) return 0;

  // Ensure current plan exists
  const currentPlan = getOrCreateWeekPlan(currentYear, currentWeekNum);
  const existingCurrent = db.getWeekPlanItems(currentPlan.id);
  let nextSort = existingCurrent.length;

  for (const src of unfinished) {
    db.insertWeekPlanItem({
      plan_id: currentPlan.id,
      title: src.title,
      description: src.description,
      project: src.project,
      priority: src.priority,
      assignee: src.assignee,
      expected_outcome: src.expected_outcome,
      status: 'pending', // Reset
      sort_order: nextSort++,
      source: 'weekplan', // Carryover still counts as user-planned
    });
  }
  return unfinished.length;
}

module.exports = {
  getOrCreateCurrentWeekPlan,
  getCurrentWeekPlan,
  getOrCreateWeekPlan,
  addItem,
  getPlanWithItems,
  checkinItem,
  renderPlan,
  generateCheckinMessage,
  carryoverFromLastWeek,
};

// ─── CLI 入口 ───────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);

  function usage() {
    console.log(`Usage: node lib/weekplan.js <command> [args]

Commands:
  create                   Create a new week plan for the current ISO week (interactive)
  list                     List all week plans
  show [week_iso]          Show a specific week's plan (default: current)
  skip [week_iso]          Mark a week as skipped (vacation/OOO)
  add-item <plan_id> --title "..." [--priority P0] [--assignee "..."]
                           Add an item to an existing plan
  checkin <item_id> <status> [--note "..."]
                           Record a check-in update for an item
  checkin-bot [plan_id]    Print the check-in message (PR1: terminal only)
  carryover [year] [week]  Copy unfinished items from last week (default: current week)
  render [plan_id]         Render a plan as readable text

Run 'node lib/weekplan.js <command> --help' for command-specific help.
`);
  }

  const [cmd, ...rest] = args;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(0);
  }

  try {
    if (cmd === 'create') {
      const plan = getOrCreateCurrentWeekPlan();
      console.log(`✓ Plan created/exists: ${plan.id}`);
      console.log(`  week_iso: ${plan.week_iso}`);
      console.log(`  dates: ${plan.start_date} ~ ${plan.end_date}`);
      console.log(`  status: ${plan.status}`);
      console.log('');
      console.log('Now run:');
      console.log(`  node lib/weekplan.js add-item ${plan.id} --title "..." [--priority P0]`);
    } else if (cmd === 'list') {
      const dbLocal = require('./db');
      const plans = dbLocal.getAllWeekPlans();
      if (plans.length === 0) {
        console.log('(no plans yet; run `create` first)');
      } else {
        plans.forEach((p) => {
          console.log(`  ${p.id}  ${p.week_iso}  ${p.start_date}~${p.end_date}  [${p.status}]`);
        });
      }
    } else if (cmd === 'show') {
      const planId = rest[0] || getOrCreateCurrentWeekPlan().id;
      console.log(renderPlan(planId));
    } else if (cmd === 'skip') {
      const weekIso = rest[0];
      const target = weekIso
        ? db.getWeekPlanByIso(weekIso)
        : getCurrentWeekPlan();
      if (!target) {
        console.error(`(no plan found${weekIso ? ' for ' + weekIso : ''})`);
        process.exit(1);
      }
      db.updateWeekPlanStatus(target.id, 'skipped');
      console.log(`✓ ${target.id} marked as skipped`);
    } else if (cmd === 'add-item') {
      // Minimal arg parsing: positional plan_id + flags
      const planId = rest[0];
      if (!planId) {
        console.error('Usage: add-item <plan_id> --title "..." [--priority P0] [--assignee "..."]');
        process.exit(1);
      }
      const titleIdx = rest.indexOf('--title');
      const priorityIdx = rest.indexOf('--priority');
      const assigneeIdx = rest.indexOf('--assignee');
      const title = titleIdx >= 0 ? rest[titleIdx + 1] : null;
      if (!title) {
        console.error('--title is required');
        process.exit(1);
      }
      const itemId = addItem(planId, {
        title,
        priority: priorityIdx >= 0 ? rest[priorityIdx + 1] : null,
        assignee: assigneeIdx >= 0 ? rest[assigneeIdx + 1] : '我',
      });
      console.log(`✓ Item added: ${itemId}`);
    } else if (cmd === 'checkin') {
      // checkin <item_id> <status> [--note "..."]
      const itemId = rest[0];
      const status = rest[1];
      if (!itemId || !status) {
        console.error('Usage: checkin <item_id> <pending|partial|done|blocked> [--note "..."]');
        process.exit(1);
      }
      const validStatuses = ['pending', 'partial', 'done', 'blocked'];
      if (!validStatuses.includes(status)) {
        console.error(`status must be one of: ${validStatuses.join(', ')}`);
        process.exit(1);
      }
      const noteIdx = rest.indexOf('--note');
      const item = db.getWeekPlanItem(itemId);
      if (!item) {
        console.error(`(item ${itemId} not found)`);
        process.exit(1);
      }
      checkinItem({
        item_id: itemId,
        plan_id: item.plan_id,
        status_after: status,
        progress_note: noteIdx >= 0 ? rest[noteIdx + 1] : null,
      });
      console.log(`✓ Check-in recorded: ${itemId} → ${status}`);
    } else if (cmd === 'checkin-bot') {
      const planId = rest[0] || getOrCreateCurrentWeekPlan().id;
      console.log(generateCheckinMessage(planId));
    } else if (cmd === 'carryover') {
      const year = rest[0] ? parseInt(rest[0], 10) : null;
      const week = rest[1] ? parseInt(rest[1], 10) : null;
      let target;
      if (year && week) {
        target = { year, weekNum: week };
      } else {
        const cur = getOrCreateCurrentWeekPlan();
        target = { year: cur.year, weekNum: cur.week_num };
      }
      const n = carryoverFromLastWeek(target.year, target.weekNum);
      console.log(`✓ Carryover: ${n} item(s) copied from last week`);
    } else if (cmd === 'render') {
      const planId = rest[0] || getOrCreateCurrentWeekPlan().id;
      console.log(renderPlan(planId));
    } else {
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
