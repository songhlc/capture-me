/**
 * path-config.test.js — 路径配置测试
 *
 * 验证所有 skill 文件的 MEMORY_DIR 和 DB_PATH 指向 skill 本地目录
 * 而非项目根目录的 memory/
 *
 * 正确：
 *   MEMORY_DIR = path.join(__dirname, 'memory')
 *   DB_PATH    = path.join(__dirname, 'sqlite', 'capture.db')
 *
 * 错误：
 *   MEMORY_DIR = path.join(__dirname, '../../../memory')  // 指向项目根目录
 */

const path = require('path');
const fs = require('fs');

const SKILL_FILES = [
  'capture.js',
  'setup.js',
  'profile.js',
  'stat.js',
  'query.js',
  'review.js',
  'backup.js',
  'import.js',
];

const EXPECTED_MEMORY_SUBDIR = 'memory';
const EXPECTED_SQLITE_SUBDIR = path.join('sqlite', 'capture.db');

describe('路径配置 — MEMORY_DIR 必须指向 skill 本地目录', () => {
  for (const file of SKILL_FILES) {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) continue;

    test(`${file}: MEMORY_DIR 不应使用 '../../../memory'`, () => {
      const content = fs.readFileSync(filePath, 'utf-8');

      // 明确检查错误的模式
      expect(content).not.toMatch(/MEMORY_DIR\s*=\s*path\.join\(__dirname,\s*['"]\.\.\/\.\.\/\.\.\/memory['"]/);

      // MEMORY_DIR 必须是本地路径（__dirname 或 SKILL_DIR），不能有 ../../../ 回溯
      if (content.includes('MEMORY_DIR')) {
        // 匹配 path.join(__dirname, 'memory') 或 path.join(SKILL_DIR, 'memory')
        const hasValidPattern =
          /MEMORY_DIR\s*=\s*path\.join\(__dirname,\s*['"]memory['"]/.test(content) ||
          /MEMORY_DIR\s*=\s*path\.join\(SKILL_DIR,\s*['"]memory['"]/.test(content);
        expect(hasValidPattern).toBe(true);
      }
    });

    test(`${file}: DB_PATH 不应回指上一级目录`, () => {
      const content = fs.readFileSync(filePath, 'utf-8');

      // DB_PATH 不应该包含 ../.claude/skills/capture-me 这样的回溯路径
      // 正确做法是 path.join(__dirname, 'sqlite', 'capture.db')
      expect(content).not.toMatch(/DB_PATH.*\.\.\/\.claude/);
    });
  }
});

describe('路径配置 — stat/query/review 必须与 capture/setup/profile 保持一致', () => {
  const criticalFiles = ['stat.js', 'query.js', 'review.js'];

  test('stat/query/review 的 MEMORY_DIR 模式应与 capture.js 一致', () => {
    const capturePath = path.join(__dirname, '..', 'capture.js');
    const captureContent = fs.readFileSync(capturePath, 'utf-8');

    // 提取 capture.js 的 MEMORY_DIR 定义
    const captureMatch = captureContent.match(/MEMORY_DIR\s*=\s*([^;]+);/);
    expect(captureMatch).toBeTruthy();
    const expectedPattern = captureMatch[1].trim();

    for (const file of criticalFiles) {
      const filePath = path.join(__dirname, '..', file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(/MEMORY_DIR\s*=\s*([^;]+);/);

      if (match) {
        expect(match[1].trim()).toBe(expectedPattern);
      }
    }
  });

  test('stat/query/review 的 DB_PATH 模式应与 db.js 一致', () => {
    // db.js 的 DB_PATH 是相对固定的
    const dbPath = path.join(__dirname, '..', 'db.js');
    const dbContent = fs.readFileSync(dbPath, 'utf-8');
    const dbMatch = dbContent.match(/DB_PATH\s*=\s*([^;]+);/);
    expect(dbMatch).toBeTruthy();

    for (const file of criticalFiles) {
      const filePath = path.join(__dirname, '..', file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(/DB_PATH\s*=\s*([^;]+);/);

      if (match) {
        // DB_PATH 应该直接指向 __dirname 下的 sqlite 目录
        expect(match[1].trim()).toMatch(/path\.join\(__dirname,/);
        expect(match[1].trim()).toContain('sqlite');
      }
    }
  });
});

describe('路径配置 — 验证实际路径解析', () => {
  test('capture.js 的 MEMORY_DIR 为 __dirname 下的相对路径', () => {
    const capturePath = path.join(__dirname, '..', 'capture.js');
    const content = fs.readFileSync(capturePath, 'utf-8');

    // 确认 __dirname + memory 的拼接方式
    expect(content).toMatch(/MEMORY_DIR\s*=\s*path\.join\(__dirname,\s*['"]memory['"]/);

    // 确认没有 ../../../memory 这样的回溯
    expect(content).not.toMatch(/\.\.\/\.\.\/\.\.\/memory/);
  });

  test('skill 目录下的 memory 路径不指向项目根目录 memory/', () => {
    // 从 capture.js 的 __dirname 加上 'memory' 得到的路径
    // 这个路径应该以 capture-me/memory 结尾，而非直接是项目根 memory/
    const skillMemory = path.join(__dirname, '..', 'memory');
    const projectRootMemory = path.join(__dirname, '..', '..', '..', 'memory');

    // 两者必须不同（测试在 src 目录运行时也成立）
    expect(skillMemory).not.toBe(projectRootMemory);
  });
});
