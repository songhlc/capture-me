#!/usr/bin/env node
/**
 * lib/progress-confirm/migrate-progress.js — 老 progress_detail 数据迁移到 v2
 *
 * 默认方案 ii：老数据（{ tasks: [...] }）全部归入 archived
 *
 * 用法：
 *   node migrate-progress.js --dry-run      # 试运行，不写
 *   node migrate-progress.js --confirm      # 确认写入
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SKILL_DIR = path.resolve(__dirname, '..', '..');
const DB_PATH = process.env.CAPTURE_ME_DB_PATH || path.join(SKILL_DIR, 'sqlite', 'capture.db');

const { upgradeProgressDetail } = require('./schema');

function openDb(readonly = false) {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`数据库不存在: ${DB_PATH}`);
  }
  return new Database(DB_PATH, { readonly });
}

function migrate(options = {}) {
  const { dryRun = true } = options;
  const db = openDb(dryRun);
  try {
    const rows = db
      .prepare(`SELECT id, project_name, progress_detail FROM projects WHERE progress_detail IS NOT NULL`)
      .all();

    const migrated = [];
    const skipped = [];

    for (const row of rows) {
      let detail;
      try {
        detail = JSON.parse(row.progress_detail);
      } catch (_) {
        skipped.push({ id: row.id, reason: 'JSON parse 失败' });
        continue;
      }

      // 已是 v2 跳过
      if (detail.version === 2) {
        skipped.push({ id: row.id, project_name: row.project_name, reason: '已是 v2' });
        continue;
      }

      const newDetail = upgradeProgressDetail(detail);

      if (!dryRun) {
        db.prepare(`UPDATE projects SET progress_detail = ? WHERE id = ?`).run(
          JSON.stringify(newDetail),
          row.id,
        );
      }

      migrated.push({
        id: row.id,
        project_name: row.project_name,
        archived_count: newDetail.archived.length,
        old_task_count: (detail.tasks || []).length,
      });
    }

    return { ok: true, migrated, skipped };
  } finally {
    db.close();
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--confirm');
  const result = migrate({ dryRun });

  console.log(`\n=== 老 progress_detail 数据迁移（${dryRun ? 'DRY-RUN' : 'CONFIRMED'}）===\n`);

  if (result.migrated.length === 0) {
    console.log('没有需要迁移的项目。');
  } else {
    console.log(`待迁移项目: ${result.migrated.length} 个`);
    for (const m of result.migrated) {
      const arrow = dryRun ? '（将）' : '（已）';
      console.log(
        `  ${arrow} ${m.project_name} (${m.id}): ${m.old_task_count} 条 task → archived`,
      );
    }
  }

  if (result.skipped.length > 0) {
    console.log(`\n跳过项目: ${result.skipped.length} 个`);
    for (const s of result.skipped) {
      console.log(`  - ${s.project_name || s.id}: ${s.reason}`);
    }
  }

  if (dryRun && result.migrated.length > 0) {
    console.log('\n加 --confirm 参数以确认写入。');
    process.exit(0);
  }

  if (!dryRun) {
    console.log('\n✅ 迁移完成');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`\n❌ 迁移失败: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { migrate };