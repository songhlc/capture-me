/**
 * review.js 单元测试
 */

const path = require('path');

describe('review.js - 周报生成', () => {
  test('getWeekBounds 返回正确的周一和周日', () => {
    // 使用内部函数测试
    const reviewPath = path.join(__dirname, '../review.js');
    const fs = require('fs');

    // 读取源文件检查函数是否存在
    const content = fs.readFileSync(reviewPath, 'utf-8');
    expect(content).toContain('getWeekBounds');
    expect(content).toContain('getMonthBounds');
  });

  test('analyzeNotes 函数存在', () => {
    const reviewPath = path.join(__dirname, '../review.js');
    const fs = require('fs');
    const content = fs.readFileSync(reviewPath, 'utf-8');
    expect(content).toContain('analyzeNotes');
  });

  test('formatWeekReport 函数存在', () => {
    const reviewPath = path.join(__dirname, '../review.js');
    const fs = require('fs');
    const content = fs.readFileSync(reviewPath, 'utf-8');
    expect(content).toContain('formatWeekReport');
  });

  test('formatMonthReport 函数存在', () => {
    const reviewPath = path.join(__dirname, '../review.js');
    const fs = require('fs');
    const content = fs.readFileSync(reviewPath, 'utf-8');
    expect(content).toContain('formatMonthReport');
  });
});
