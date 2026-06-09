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

module.exports = {
  getOrCreateCurrentWeekPlan,
  getCurrentWeekPlan,
};
