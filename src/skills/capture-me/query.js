#!/usr/bin/env node
/**
 * query.js — 搜索查询
 * 从 SQLite 和 Markdown 文件中搜索记录
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MEMORY_DIR = path.join(__dirname, 'memory');
const DB_PATH = path.join(__dirname, 'sqlite', 'capture.db');
const CAPTURE_LOG = path.join(MEMORY_DIR, 'capture-log.md');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

function searchInSqlite(db, keyword, limit = 20) {
  const pattern = `%${keyword}%`;
  const stmt = db.prepare(`
    SELECT id, date, time, raw_text, ai_summary, category, tags, is_todo, todo_due, todo_done
    FROM notes
    WHERE raw_text LIKE ? OR ai_summary LIKE ? OR tags LIKE ?
    ORDER BY date DESC, time DESC
    LIMIT ?
  `);
  return stmt.all(pattern, pattern, pattern, limit);
}

function searchInMarkdown(keyword, limit = 10) {
  if (!fs.existsSync(CAPTURE_LOG)) return [];

  const content = fs.readFileSync(CAPTURE_LOG, 'utf-8');
  const lines = content.split('\n');
  const results = [];
  const keywordLower = keyword.toLowerCase();

  for (const line of lines) {
    if (line.startsWith('> ') && line.toLowerCase().includes(keywordLower)) {
      results.push({
        text: line.replace(/^> /, '').replace(/ — .*$/, ''),
        raw: line,
      });
      if (results.length >= limit) break;
    }
  }

  return results;
}

function getAllTodos(db) {
  const stmt = db.prepare(`
    SELECT id, date, time, raw_text, ai_summary, todo_due, todo_done
    FROM notes
    WHERE is_todo = 1
    ORDER BY todo_done ASC, todo_due ASC, date DESC
  `);
  return stmt.all();
}

function formatTodosTable(todos) {
  if (todos.length === 0) {
    return `📋 待办列表\n═══════════════════════════════════════\n\n暂无待办\n`;
  }

  const pending = todos.filter(t => !t.todo_done);
  const completed = todos.filter(t => t.todo_done);
  const completionRate = Math.round((completed.length / todos.length) * 100);

  let lines = [
    `📋 待办列表`,
    `═══════════════════════════════════════`,
    ``,
  ];

  const fmtRow = (id, due, content) => {
    const maxLen = 50;
    const displayContent = content.length > maxLen ? content.slice(0, maxLen - 3) + '...' : content;
    return `${id.padEnd(10)} ${due.padEnd(12)} ${displayContent}`;
  };

  if (pending.length > 0) {
    lines.push(`⏳ 待处理（${pending.length}条）`);
    lines.push(`──────────────────────────────────────`);
    lines.push(`ID         截止日期     内容`);
    for (const t of pending) {
      const due = t.todo_due ? t.todo_due.split('T')[0] : '未设置';
      lines.push(fmtRow(t.id.slice(-10), due, t.raw_text));
    }
    lines.push(``);
  }

  if (completed.length > 0) {
    lines.push(`✓ 已完成（${completed.length}条）`);
    lines.push(`──────────────────────────────────────`);
    lines.push(`ID         截止日期     内容`);
    for (const t of completed) {
      const due = t.todo_due ? t.todo_due.split('T')[0] : '未设置';
      lines.push(fmtRow(t.id.slice(-10), due, t.raw_text));
    }
    lines.push(``);
  }

  lines.push(`──────────────────────────────────────`);
  lines.push(`共 ${todos.length} 条待办，完成率 ${completionRate}%`);
  lines.push(`完成待办：done <id>`);

  return lines.join('\n');
}

function formatResults(sqliteResults, markdownResults, keyword) {
  const lines = [
    `🔍 搜索结果：「${keyword}」`,
    `═══════════════════════════════════════`,
    ``,
  ];

  if (sqliteResults.length === 0 && markdownResults.length === 0) {
    lines.push(`未找到相关记录`);
    return lines.join('\n');
  }

  if (sqliteResults.length > 0) {
    lines.push(`## SQLite 索引（${sqliteResults.length}条）`);
    for (const r of sqliteResults) {
      const summary = r.ai_summary ? `\n   AI摘要：${r.ai_summary}` : '';
      const todo = r.is_todo ? ` ⏳ ${r.todo_due || '待办'}` : '';
      const done = r.todo_done ? ` ✓` : '';
      lines.push(``);
      lines.push(`[${r.date} ${r.time}] ${r.raw_text.slice(0, 100)}${r.raw_text.length > 100 ? '...' : ''}${summary}${todo}${done}`);
    }
  }

  if (markdownResults.length > 0) {
    lines.push(``);
    lines.push(`## 随手记（${markdownResults.length}条）`);
    for (const r of markdownResults) {
      lines.push(`  ${r.raw}`);
    }
  }

  return lines.join('\n');
}

function query(keyword, limit = 20) {
  const db = ensureDb();

  // Special handling for todos command
  if (keyword === 'todos' && db) {
    const todos = getAllTodos(db);
    db.close();
    return formatTodosTable(todos);
  }

  let sqliteResults = [];
  let markdownResults = [];

  if (db) {
    sqliteResults = searchInSqlite(db, keyword, limit);
    db.close();
  }

  markdownResults = searchInMarkdown(keyword, Math.floor(limit / 2));

  return formatResults(sqliteResults, markdownResults, keyword);
}

/**
 * 优化版：SQLite + Markdown 搜索并行执行
 */
async function queryAsync(keyword, limit = 20) {
  const db = ensureDb();

  // Special handling for todos command
  if (keyword === 'todos' && db) {
    const todos = getAllTodos(db);
    db.close();
    return formatTodosTable(todos);
  }

  // 并行执行 SQLite + Markdown 搜索
  const [sqliteResults, markdownResults] = await Promise.all([
    db
      ? new Promise(resolve => {
          const results = searchInSqlite(db, keyword, limit);
          db.close();
          resolve(results);
        })
      : Promise.resolve([]),
    new Promise(resolve => {
      resolve(searchInMarkdown(keyword, Math.floor(limit / 2)));
    }),
  ]);

  return formatResults(sqliteResults, markdownResults, keyword);
}

// CLI
if (require.main === module) {
  const keyword = process.argv.slice(2).join(' ');
  if (!keyword) {
    console.log('用法: node query.js "<关键词>"');
    process.exit(1);
  }
  queryAsync(keyword).then(output => console.log(output));
}

module.exports = { query, queryAsync, searchInSqlite };
