/**
 * lib/progress-confirm/applier.js — 把 parser 解析出来的状态变更落库
 *
 * 行为：
 *   1. 遍历 projects（已被 parser mutate 过 _pending_new_status）
 *   2. 每个变动的 item：
 *      - 更新 status
 *      - 追加 history
 *      - 清理临时字段 (_pending_* / _empty / _progress_note / _source)
 *   3. status === 'drop' 的项从 items 移到 archived
 *   4. UPDATE projects SET progress_detail = ?
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SKILL_DIR = path.resolve(__dirname, '..', '..');
const DB_PATH = process.env.CAPTURE_ME_DB_PATH || path.join(SKILL_DIR, 'sqlite', 'capture.db');

function openDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`数据库不存在: ${DB_PATH}`);
  }
  return new Database(DB_PATH);
}

/**
 * 把变更应用到 SQLite
 *
 * @param {Array} projects - scanner 输出（已被 parser mutate）
 * @param {object} [options]
 * @param {string} [options.weekIso]
 * @param {boolean} [options.dryRun=false]
 * @returns {{ ok: boolean, applied: Array, dropped: Array, errors: Array }}
 */
function applyChanges(projects, options = {}) {
  const { weekIso, dryRun = false } = options;
  const now = new Date().toISOString();

  const applied = [];
  const dropped = [];
  const errors = [];

  if (!dryRun) {
    const db = openDb();
    try {
      const updateStmt = db.prepare(
        `UPDATE projects SET progress_detail = ?, last_updated = ? WHERE id = ?`,
      );

      // 先把数据库里当前的 progress_detail 全部读出来备用
      const selectStmt = db.prepare(
        `SELECT id, progress_detail FROM projects WHERE id = ?`,
      );
      const rawById = new Map();
      for (const proj of projects) {
        const row = selectStmt.get(proj.project_id);
        if (!row) continue;
        rawById.set(proj.project_id, row.progress_detail);
      }

      const tx = db.transaction(() => {
        for (const proj of projects) {
          const rawDetail = rawById.get(proj.project_id);
          if (rawDetail === undefined) {
            errors.push(`项目 ${proj.project_name} (${proj.project_id}) 不存在，跳过`);
            continue;
          }

          let detail;
          try {
            detail = rawDetail ? JSON.parse(rawDetail) : null;
          } catch (_) {
            detail = null;
          }

          // 走和 scanner 一致的升级逻辑
          const { upgradeProgressDetail } = require('./schema');
          detail = upgradeProgressDetail(detail);

          // 用 scanner 解析后的 items（含回填）覆盖数据库里的
          // 这样回填的 items 也能正确处理 _pending_new_status
          if (Array.isArray(proj.items)) {
            detail.items = proj.items;
          }

          const nextItems = [];
          for (const item of detail.items) {
            const newStatus = item._pending_new_status;
            if (!newStatus) {
              // 未变更的项保留
              nextItems.push(stripTempFields(item));
              continue;
            }

            const history = Array.isArray(item.history) ? item.history : [];
            history.push({
              week: weekIso || null,
              old_status: item.status,
              new_status: newStatus,
              confirmed_at: now,
              note: item._pending_note || null,
            });

            const updated = stripTempFields({
              ...item,
              status: newStatus,
              last_confirmed_at: now,
              last_confirmed_week: weekIso || item.last_confirmed_week || null,
              history,
            });

            applied.push({
              project_id: proj.project_id,
              project_name: proj.project_name,
              item_id: item.id,
              item_title: item.title,
              old_status: item.status,
              new_status: newStatus,
            });

            if (newStatus === 'drop') {
              detail.archived.push({
                title: item.title,
                dropped_at: now,
                reason: 'weekly-confirm',
                note: item._pending_note || null,
              });
              dropped.push({
                project_name: proj.project_name,
                item_title: item.title,
              });
            } else {
              nextItems.push(updated);
            }
          }

          detail.items = nextItems;

          updateStmt.run(JSON.stringify(detail), now, proj.project_id);
        }
      });

      tx();
    } finally {
      db.close();
    }
  } else {
    // dry-run：只统计，不写
    for (const proj of projects) {
      for (const item of proj.items || []) {
        const newStatus = item._pending_new_status;
        if (!newStatus) continue;
        applied.push({
          project_id: proj.project_id,
          project_name: proj.project_name,
          item_id: item.id,
          item_title: item.title,
          old_status: item.status,
          new_status: newStatus,
        });
        if (newStatus === 'drop') {
          dropped.push({ project_name: proj.project_name, item_title: item.title });
        }
      }
    }
  }

  return { ok: errors.length === 0, applied, dropped, errors };
}

function stripTempFields(item) {
  const cleaned = { ...item };
  delete cleaned._pending_new_status;
  delete cleaned._pending_note;
  delete cleaned._empty;
  delete cleaned._progress_note;
  delete cleaned._source;
  delete cleaned._priority;
  return cleaned;
}

module.exports = { applyChanges, DB_PATH };