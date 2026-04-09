#!/usr/bin/env node
/**
 * query.js — 搜索查询
 * 从 SQLite 和 Markdown 文件中搜索记录
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MEMORY_DIR = path.join(__dirname, '../../../memory');
const DB_PATH = path.join(MEMORY_DIR, '../.claude/skills/capture-you/sqlite/capture.db');
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
  let currentEntry = null;
  const keywordLower = keyword.toLowerCase();

  for (const line of lines) {
    if (line.startsWith('> ') && line.toLowerCase().includes(keywordLower)) {
      currentEntry = {
        text: line.replace(/^> /, '').replace(/ — .*$/, ''),
        raw: line,
      };
      results.push(currentEntry);
      if (results.length >= limit) break;
    }
  }

  return results;
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
  let sqliteResults = [];
  let markdownResults = [];

  if (db) {
    sqliteResults = searchInSqlite(db, keyword, limit);
    db.close();
  }

  markdownResults = searchInMarkdown(keyword, Math.floor(limit / 2));

  return formatResults(sqliteResults, markdownResults, keyword);
}

// CLI
if (require.main === module) {
  const keyword = process.argv.slice(2).join(' ');
  if (!keyword) {
    console.log('用法: node query.js "<关键词>"');
    process.exit(1);
  }
  console.log(query(keyword));
}

module.exports = { query, searchInSqlite };
