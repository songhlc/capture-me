/**
 * query.js 单元测试
 */

const path = require('path');

describe('query.js - 搜索功能', () => {
  test('query 函数存在', () => {
    const queryPath = path.join(__dirname, '../query.js');
    const fs = require('fs');
    const content = fs.readFileSync(queryPath, 'utf-8');
    expect(content).toContain('function query');
    expect(content).toContain('searchInSqlite');
    expect(content).toContain('searchInMarkdown');
  });

  test('formatResults 函数存在', () => {
    const queryPath = path.join(__dirname, '../query.js');
    const fs = require('fs');
    const content = fs.readFileSync(queryPath, 'utf-8');
    expect(content).toContain('function formatResults');
  });
});
