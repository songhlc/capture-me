#!/usr/bin/env node
/**
 * backup.js — capture-you 数据备份
 *
 * 功能：
 *   - 备份用户数据到指定目录
 *   - 支持手动备份和定期备份
 *   - 自动清理过期备份
 *
 * 用法:
 *   node backup.js              # 备份到默认目录
 *   node backup.js --path /xxx  # 备份到指定目录
 *   node backup.js --keep 7    # 保留最近 7 份备份（默认 5）
 *   node backup.js --list       # 列出已有备份
 *   node backup.js --restore    # 从最新备份恢复
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SKILL_DIR = __dirname;
const MEMORY_DIR = path.join(SKILL_DIR, 'memory');
const SQLITE_DIR = path.join(SKILL_DIR, 'sqlite');
const DEFAULT_BACKUP_DIR = path.join(SKILL_DIR, 'backups');
const DEFAULT_KEEP = 5;

// ─── 颜色输出 ────────────────────────────────────────────

const c = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

function log(color, ...args) {
  console.log(`${color}${args.join(' ')}${c.reset}`);
}

// ─── 备份目标文件列表 ────────────────────────────────────

function getBackupFiles() {
  const files = [];

  // memory/ 目录
  if (fs.existsSync(MEMORY_DIR)) {
    for (const f of fs.readdirSync(MEMORY_DIR)) {
      files.push(path.join(MEMORY_DIR, f));
    }
  }

  // sqlite/ 目录
  if (fs.existsSync(SQLITE_DIR)) {
    for (const f of fs.readdirSync(SQLITE_DIR)) {
      if (f.endsWith('.db')) {
        files.push(path.join(SQLITE_DIR, f));
      }
    }
  }

  return files;
}

// ─── 备份核心 ────────────────────────────────────────────

function doBackup(backupDir, label) {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupSubDir = path.join(backupDir, `${label || 'backup'}-${timestamp}`);

  fs.mkdirSync(backupSubDir, { recursive: true });

  const files = getBackupFiles();
  if (files.length === 0) {
    log(c.yellow, '⚠ 没有找到需要备份的数据文件');
    return null;
  }

  // 复制每个文件
  let count = 0;
  for (const srcFile of files) {
    const filename = path.basename(srcFile);
    const destFile = path.join(backupSubDir, filename);
    fs.copyFileSync(srcFile, destFile);
    count++;
  }

  // 写入备份元信息
  const meta = {
    timestamp: new Date().toISOString(),
    label: label || 'manual',
    files: files.map(f => path.basename(f)),
    count,
  };
  fs.writeFileSync(
    path.join(backupSubDir, '.backup-meta.json'),
    JSON.stringify(meta, null, 2)
  );

  return { backupSubDir, count };
}

// ─── 清理旧备份 ────────────────────────────────────────────

function cleanupOldBackups(backupDir, keep) {
  if (!fs.existsSync(backupDir)) return 0;

  const entries = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({
      name: e.name,
      path: path.join(backupDir, e.name),
      mtime: fs.statSync(path.join(backupDir, e.name)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  let deleted = 0;
  for (let i = keep; i < entries.length; i++) {
    // 只删除 backup- 开头的目录
    if (entries[i].name.startsWith('backup-')) {
      execSync(`rm -rf "${entries[i].path}"`);
      deleted++;
    }
  }

  return deleted;
}

// ─── 列出备份 ────────────────────────────────────────────

function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) {
    log(c.dim, '暂无备份');
    return [];
  }

  const entries = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('backup-'))
    .map(e => {
      const metaPath = path.join(backupDir, e.name, '.backup-meta.json');
      let meta = {};
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
      }
      const stat = fs.statSync(path.join(backupDir, e.name));
      return {
        name: e.name,
        path: path.join(backupDir, e.name),
        time: stat.mtime,
        meta,
      };
    })
    .sort((a, b) => b.time - a.time);

  return entries;
}

// ─── 恢复备份 ────────────────────────────────────────────

function restoreBackup(backupPath) {
  if (!fs.existsSync(backupPath)) {
    log(c.yellow, `⚠ 备份不存在：${backupPath}`);
    return false;
  }

  const files = fs.readdirSync(backupPath).filter(f => f !== '.backup-meta.json');

  for (const file of files) {
    const srcFile = path.join(backupPath, file);
    let destDir, destFile;

    if (file.endsWith('.db')) {
      destDir = SQLITE_DIR;
    } else {
      destDir = MEMORY_DIR;
    }

    destFile = path.join(destDir, file);

    // 确保目标目录存在
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(srcFile, destFile);
    log(c.green, `  ✓ 恢复: ${file}`);
  }

  return true;
}

// ─── CLI ────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let backupDir = DEFAULT_BACKUP_DIR;
  let keep = DEFAULT_KEEP;
  let label = 'manual';

  // 解析参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path' && args[i + 1]) {
      backupDir = args[++i];
    } else if (args[i] === '--keep' && args[i + 1]) {
      keep = parseInt(args[++i], 10);
    } else if (args[i] === '--list') {
      const backups = listBackups(backupDir);
      if (backups.length === 0) {
        log(c.dim, '暂无备份');
      } else {
        log(c.blue, `📦 备份列表（保存于 ${backupDir}）：\n`);
        for (const b of backups) {
          const time = b.time.toLocaleString('zh-CN');
          const count = b.meta.count || '?';
          log(c.green, `  ${b.name}`);
          log(c.dim, `    ${time} · ${count} 个文件`);
        }
      }
      return;
    } else if (args[i] === '--restore') {
      const backups = listBackups(backupDir);
      if (backups.length === 0) {
        log(c.yellow, '⚠ 没有可恢复的备份');
        return;
      }
      const latest = backups[0];
      log(c.blue, `🔄 从最新备份恢复：${latest.name}`);
      restoreBackup(latest.path);
      log(c.green, '✓ 恢复完成');
      return;
    }
  }

  // 执行备份
  log(c.blue, '📦 开始备份...\n');

  const result = doBackup(backupDir, label);
  if (!result) return;

  log(c.green, `  ✓ 备份完成：${result.count} 个文件`);
  log(c.dim, `  位置：${result.backupSubDir}`);

  // 清理旧备份
  const deleted = cleanupOldBackups(backupDir, keep);
  if (deleted > 0) {
    log(c.yellow, `  🗑 清理了 ${deleted} 份旧备份（保留最近 ${keep} 份）`);
  }
}

// ─── 导出供 capture.js 调用（静默备份） ───────────────

function silentBackup(backupDir = DEFAULT_BACKUP_DIR) {
  try {
    const result = doBackup(backupDir, 'auto');
    cleanupOldBackups(backupDir, DEFAULT_KEEP);
    return result;
  } catch (e) {
    return null;
  }
}

if (require.main === module) {
  main();
}

module.exports = { silentBackup, doBackup, listBackups, restoreBackup };
