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

module.exports = {
  getOrCreateCurrentWeekPlan,
  getCurrentWeekPlan,
  addItem,
  getPlanWithItems,
  checkinItem,
};
