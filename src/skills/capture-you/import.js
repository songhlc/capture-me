#!/usr/bin/env node
/**
 * import.js — 通用结构化数据导入工具
 *
 * 设计原则：
 * - 模板可配置，格式可扩展
 * - 自动检测输入格式（markdown table / CSV / JSON / JSONlines）
 * - 字段映射可自定义
 * - 支持批量插入 SQLite
 *
 * 用法：
 *   node import.js --templates              # 列出所有内置模板
 *   node import.js --define <name> <spec>  # 定义新模板
 *   node import.js --detect <data>          # 检测格式
 *   node import.js [--template <name>] <data>  # 导入数据
 *
 * 模板定义格式（JSON）：
 * {
 *   "name": "work-progress",
 *   "description": "工作专项表格",
 *   "format": "markdown-table" | "csv" | "json" | "jsonl",
 *   "fields": {
 *     "raw_text":    { "source": "col:2" | "const:value" | "template:" },
 *     "ai_summary":  { "source": "col:0", "maxLen": 50 },
 *     "category":    { "source": "const:work" },
 *     "tags":        { "source": "col:1", "sep": "/" },
 *     ...
 *   },
 *   "options": {
 *     "skipEmpty": true,
 *     "dedup": { "fields": ["raw_text"], "window": "7d" }
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const TEMPLATES_DIR = path.join(__dirname, 'templates', 'import');
const DB_PATH = path.join(__dirname, 'sqlite', 'capture.db');

// ─── 内置模板 ────────────────────────────────────────────

const BUILTIN_TEMPLATES = {
  'markdown-table': {
    name: 'markdown-table',
    description: 'Markdown 表格（自动检测表头）',
    format: 'markdown-table',
    fields: {
      raw_text:    { source: 'row', maxLen: 500 },
      ai_summary:  { source: 'row', maxLen: 80 },
    },
    options: { skipEmpty: true },
  },
  'csv': {
    name: 'csv',
    description: 'CSV 格式（第一行自动作为列名）',
    format: 'csv',
    fields: {
      raw_text:   { source: 'row' },
      ai_summary: { source: 'row', maxLen: 80 },
    },
    options: { skipEmpty: true },
  },
  'json-array': {
    name: 'json-array',
    description: 'JSON 数组',
    format: 'json',
    fields: {
      raw_text:   { source: 'key:_', maxLen: 500 },
      ai_summary: { source: 'key:_', maxLen: 80 },
    },
    options: {},
  },
};

// ─── 模板加载 ────────────────────────────────────────────

function loadTemplates() {
  const templates = { ...BUILTIN_TEMPLATES };

  if (fs.existsSync(TEMPLATES_DIR)) {
    for (const file of fs.readdirSync(TEMPLATES_DIR)) {
      if (file.endsWith('.json')) {
        const spec = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8'));
        templates[spec.name] = spec;
      }
    }
  }

  return templates;
}

function saveTemplate(name, spec) {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(TEMPLATES_DIR, `${name}.json`), JSON.stringify(spec, null, 2));
}

// ─── 格式检测 ────────────────────────────────────────────

function detectFormat(data) {
  const trimmed = data.trim();

  // JSON array
  if (trimmed.startsWith('[')) {
    try { JSON.parse(trimmed); return 'json'; } catch {}
  }

  // JSON lines
  if (trimmed.includes('\n') && trimmed.split('\n').every(l => { try { JSON.parse(l); return true; } catch { return false; } })) {
    return 'jsonl';
  }

  // CSV (第一行不含 |)
  const lines = trimmed.split('\n');
  if (lines[0] && !lines[0].includes('|') && lines[0].includes(',')) {
    return 'csv';
  }

  // Markdown table
  if (lines.some(l => l.startsWith('|') && l.includes('---'))) {
    return 'markdown-table';
  }

  return 'unknown';
}

// ─── 解析器 ────────────────────────────────────────────

function parseMarkdownTable(data) {
  const lines = data.trim().split('\n').filter(l => l.trim() && !l.match(/^\|[-| :]+\|$/));
  if (lines.length === 0) return [];

  // 解析表头
  const headerLine = lines[0];
  const headers = headerLine.split('|')
    .filter(c => c.trim())
    .map(c => c.trim());

  // 解析数据行
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('|').filter(c => c.trim()).map(c => c.trim());
    if (cells.length === 0) continue;

    const row = {};
    for (let j = 0; j < headers.length && j < cells.length; j++) {
      row[headers[j]] = cells[j];
    }
    rows.push(row);
  }

  return rows;
}

function parseCSV(data) {
  const lines = data.trim().split('\n');
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (cells.length === 0) continue;

    const row = {};
    for (let j = 0; j < headers.length && j < cells.length; j++) {
      row[headers[j]] = cells[j];
    }
    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseJSON(data) {
  const arr = JSON.parse(data);
  if (Array.isArray(arr)) return arr;
  return [arr];
}

function parseJSONL(data) {
  return data.trim().split('\n').map(l => JSON.parse(l));
}

function parseData(data, format) {
  switch (format) {
    case 'markdown-table': return parseMarkdownTable(data);
    case 'csv': return parseCSV(data);
    case 'json': return parseJSON(data);
    case 'jsonl': return parseJSONL(data);
    default: throw new Error(`不支持的格式: ${format}`);
  }
}

// ─── 字段映射 ────────────────────────────────────────────

/**
 * source 类型：
 *   "col:N"       — 取第 N 列（从 0 开始）
 *   "const:xxx"   — 固定常量值
 *   "key:name"    — 取 JSON 对象中 key 为 name 的字段
 *   "row"         — 整行 JSON 字符串（用于 fallback）
 *   "template:xxx"— 模板字符串，支持 {col0}, {col1}, {name} 占位
 */
function resolveField(source, row, rowIndex) {
  if (source.startsWith('const:')) {
    return source.slice(6);
  }

  if (source === 'row') {
    return typeof row === 'string' ? row : JSON.stringify(row);
  }

  if (source.startsWith('col:')) {
    const idx = parseInt(source.slice(4), 10);
    if (Array.isArray(row)) return row[idx] || '';
    const keys = Object.keys(row);
    return keys[idx] ? row[keys[idx]] : '';
  }

  if (source.startsWith('key:')) {
    const key = source.slice(4);
    if (typeof row === 'object' && row !== null) return row[key] || '';
    return '';
  }

  if (source.startsWith('template:')) {
    const tmpl = source.slice(9);
    return tmpl.replace(/\{(\w+)\}/g, (_, k) => row[k] || '');
  }

  if (source.startsWith('template:col:')) {
    const tmpl = source.slice(12);
    return tmpl.replace(/\{col(\d+)\}/g, (_, idx) => {
      if (Array.isArray(row)) return row[parseInt(idx)] || '';
      const keys = Object.keys(row);
      return keys[parseInt(idx)] ? row[keys[parseInt(idx)]] : '';
    });
  }

  return '';
}

function applyTemplate(rows, template) {
  const results = [];
  const { fields, options = {} } = template;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // 跳过空行
    if (options.skipEmpty) {
      const firstVal = Object.values(row)[0];
      if (!firstVal || String(firstVal).trim() === '' || firstVal === '---') continue;
    }

    const record = {};

    for (const [field, config] of Object.entries(fields)) {
      let value = resolveField(config.source, row, i);

      if (config.maxLen && typeof value === 'string' && value.length > config.maxLen) {
        value = value.slice(0, config.maxLen - 3) + '...';
      }

      if (config.sep) {
        value = value.split(config.sep).map(s => s.trim()).filter(Boolean);
      }

      if (config.json && typeof value === 'string') {
        try { value = JSON.parse(value); } catch {}
      }

      if (config.default !== undefined && (!value || value === '')) {
        value = config.default;
      }

      record[field] = value;
    }

    results.push(record);
  }

  return results;
}

// ─── 去重 ────────────────────────────────────────────

function deduplicate(records, options) {
  if (!options.dedup) return records;

  const { fields, window } = options.dedup;
  const seen = new Map();

  return records.filter(record => {
    const key = fields.map(f => record[f] || '').join('|');

    if (seen.has(key)) {
      return false;
    }

    seen.set(key, true);
    return true;
  });
}

// ─── 数据库写入 ────────────────────────────────────────────

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH);
}

function batchInsert(records, defaults = {}) {
  const db = ensureDb();
  if (!db) { console.error('数据库不存在'); return 0; }

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const time = now.toTimeString().slice(0, 5);

  const stmt = db.prepare(`
    INSERT INTO notes (id, date, time, raw_text, ai_summary, category, tags, extracted_entities, is_todo, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const record of records) {
    const id = 'import-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

    stmt.run(
      id,
      record.date || today,
      record.time || time,
      record.raw_text || '',
      record.ai_summary || null,
      record.category || defaults.category || 'life',
      record.tags ? JSON.stringify(Array.isArray(record.tags) ? record.tags : [record.tags]) : null,
      record.extracted_entities ? JSON.stringify(record.extracted_entities) : null,
      record.is_todo ? 1 : 0,
      record.source || 'import',
    );
    count++;
  }

  db.close();
  return count;
}

// ─── CLI ────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  // --templates
  if (args.includes('--templates')) {
    const templates = loadTemplates();
    console.log('可用模板：');
    for (const [name, t] of Object.entries(templates)) {
      console.log(`  ${name}  — ${t.description}`);
    }
    return;
  }

  // --detect
  if (args.includes('--detect')) {
    const data = args.slice(args.indexOf('--detect') + 1).join(' ');
    const format = detectFormat(data);
    console.log(`检测格式: ${format}`);
    return;
  }

  // --define
  const defineIdx = args.indexOf('--define');
  if (defineIdx !== -1) {
    const name = args[defineIdx + 1];
    const specStr = args.slice(defineIdx + 2).join(' ');
    try {
      const spec = JSON.parse(specStr);
      saveTemplate(name, { ...spec, name });
      console.log(`✓ 模板 "${name}" 已保存`);
    } catch (e) {
      console.error('模板定义必须是有效 JSON');
    }
    return;
  }

  // --template
  const templateIdx = args.indexOf('--template');
  let templateName = 'markdown-table';
  let dataStart = 0;

  if (templateIdx !== -1) {
    templateName = args[templateIdx + 1];
    dataStart = templateIdx + 2;
  }

  const data = args.slice(dataStart).join(' ').replace(/^["']|["']$/g, '');

  if (!data) {
    console.log(`用法:`);
    console.log(`  node import.js --templates              # 列出模板`);
    console.log(`  node import.js --detect <data>          # 检测格式`);
    console.log(`  node import.js --define <name> <json>   # 定义模板`);
    console.log(`  node import.js [--template <name>] <data>  # 导入数据`);
    return;
  }

  // 自动检测格式
  let format = detectFormat(data);
  if (templateName === 'auto') templateName = format;

  const templates = loadTemplates();
  let template = templates[templateName];

  // 自动检测格式时，尝试用 markdown-table 作为默认
  if (!template && format !== 'unknown') {
    template = templates[format] || templates['markdown-table'];
  }

  if (!template) {
    console.error(`未知模板: ${templateName}`);
    return;
  }

  // 解析
  let rows;
  try {
    rows = parseData(data, template.format || format);
  } catch (e) {
    console.error(`解析失败: ${e.message}`);
    return;
  }

  // 应用映射
  const records = applyTemplate(rows, template);

  // 去重
  const deduped = deduplicate(records, template.options || {});

  // 写入
  const count = batchInsert(deduped);

  console.log(`✓ 成功导入 ${count} 条记录`);
  if (records.length !== deduped.length) {
    console.log(`  (跳过 ${records.length - deduped.length} 条重复)`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { detectFormat, parseData, applyTemplate, loadTemplates, batchInsert };
