/**
 * profile.js 单元测试
 */

const path = require('path');

describe('profile.js - 性格画像', () => {
  test('analyzeEmotions 函数存在', () => {
    const profilePath = path.join(__dirname, '../profile.js');
    const fs = require('fs');
    const content = fs.readFileSync(profilePath, 'utf-8');
    expect(content).toContain('function analyzeEmotions');
    expect(content).toContain('EMOTION_KEYWORDS');
  });

  test('analyzePeople 函数存在', () => {
    const profilePath = path.join(__dirname, '../profile.js');
    const fs = require('fs');
    const content = fs.readFileSync(profilePath, 'utf-8');
    expect(content).toContain('function analyzePeople');
  });

  test('analyzeTodos 函数存在', () => {
    const profilePath = path.join(__dirname, '../profile.js');
    const fs = require('fs');
    const content = fs.readFileSync(profilePath, 'utf-8');
    expect(content).toContain('function analyzeTodos');
  });

  test('generateProfile 函数存在', () => {
    const profilePath = path.join(__dirname, '../profile.js');
    const fs = require('fs');
    const content = fs.readFileSync(profilePath, 'utf-8');
    expect(content).toContain('function generateProfile');
  });
});
