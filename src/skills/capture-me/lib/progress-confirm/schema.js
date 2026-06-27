/**
 * lib/progress-confirm/schema.js — progress_detail 的 v2 schema
 *
 * 老格式：{ tasks: [{ name, current, total }] }
 * 新格式：{ version: 2, items: [...], archived: [...] }
 *
 * 每个 item：进度条目，由周度确认机制维护。
 * archived：从老格式迁移过来的条目，默认隐藏但保留历史可追溯。
 *
 * 状态四态：active | done | drop | blocked
 *   - active  在做
 *   - done    已完成
 *   - drop    已放弃（移入 archived）
 *   - blocked 阻塞中（保留在 items，状态变更可追溯）
 */

const VALID_STATUS = new Set(['active', 'done', 'drop', 'blocked']);

const DEFAULT_PROGRESS_DETAIL = Object.freeze({
  version: 2,
  items: [],
  archived: [],
});

/**
 * 把 progress_detail 升级到 v2 schema
 *
 * @param {object|null|undefined} oldDetail
 * @returns {object} v2 schema
 */
function upgradeProgressDetail(oldDetail) {
  if (!oldDetail) return cloneDefault();

  if (oldDetail.version === 2) {
    return {
      version: 2,
      items: Array.isArray(oldDetail.items) ? oldDetail.items : [],
      archived: Array.isArray(oldDetail.archived) ? oldDetail.archived : [],
    };
  }

  // 老格式 → v2：按方案 4 决策 4 (ii)，老数据全部 archived
  const oldTasks = Array.isArray(oldDetail.tasks) ? oldDetail.tasks : [];
  return {
    version: 2,
    items: [],
    archived: oldTasks.map((t) => ({
      title: t.name || '(未命名)',
      original_task: t,
      migrated_at: new Date().toISOString(),
      reason: 'pre-confirm-migration',
    })),
  };
}

function cloneDefault() {
  return { version: 2, items: [], archived: [] };
}

/**
 * 从 week_plan_updates 表回填本周进展
 *
 * 当 progress_detail.items 为空时调用，从已有的 week_plan_updates 表拉本周记录。
 * 这样首次跑 confirm 不需要用户手动录入新数据。
 *
 * @param {object} db - better-sqlite3 实例
 * @param {string} projectName - 项目名（用于 LIKE 匹配 week_plan_items.title 或 project）
 * @param {string} weekIso - 形如 2026-W26
 * @returns {Array<object>}
 */
function backfillFromWeekPlan(db, projectName, weekIso) {
  if (!db || !projectName || !weekIso) return [];

  let rows;
  try {
    rows = db
      .prepare(
        `
        SELECT wpu.id, wpu.progress_note, wpu.created_at, wpi.title, wpi.priority, wpi.status as item_status
        FROM week_plan_updates wpu
        JOIN week_plan_items wpi ON wpu.item_id = wpi.id
        WHERE wpu.week_iso = ?
          AND (wpi.title LIKE ? OR wpi.project = ?)
        ORDER BY wpu.created_at DESC
      `,
      )
      .all(weekIso, `%${projectName}%`, projectName);
  } catch (_) {
    // 表可能不存在（未启用 weekplan 模块）
    return [];
  }

  return rows.map((r) => ({
    id: `pi_wpu_${r.id}`,
    title: r.title,
    status: 'active',
    created_at: r.created_at,
    last_confirmed_at: null,
    last_confirmed_week: null,
    history: [],
    _source: 'week_plan_updates',
    _progress_note: r.progress_note,
    _priority: r.priority,
  }));
}

/**
 * 把项目当前状态推进到 v2 + 必要时回填
 *
 * @param {object} db
 * @param {object} row - projects 表的一行
 * @param {string} weekIso
 * @returns {object} { detail, source: 'existing' | 'backfill' | 'empty' }
 */
function resolveProgressDetail(db, row, weekIso) {
  let detail;
  try {
    detail = row.progress_detail ? JSON.parse(row.progress_detail) : null;
  } catch (_) {
    detail = null;
  }

  detail = upgradeProgressDetail(detail);

  if (detail.items.length > 0) {
    return { detail, source: 'existing' };
  }

  const backfilled = backfillFromWeekPlan(db, row.project_name, weekIso);
  if (backfilled.length > 0) {
    detail.items = backfilled;
    return { detail, source: 'backfill' };
  }

  // 空项目：给一个提示占位项
  detail.items = [
    {
      id: `pi_empty_${row.id}`,
      title: '（本周暂无更新）',
      status: 'active',
      created_at: new Date().toISOString(),
      last_confirmed_at: null,
      last_confirmed_week: null,
      history: [],
      _empty: true,
    },
  ];
  return { detail, source: 'empty' };
}

module.exports = {
  VALID_STATUS,
  DEFAULT_PROGRESS_DETAIL,
  upgradeProgressDetail,
  backfillFromWeekPlan,
  resolveProgressDetail,
};