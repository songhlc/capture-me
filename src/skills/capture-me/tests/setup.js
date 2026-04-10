/**
 * Jest 测试环境初始化
 */

// 测试配置
process.env.NODE_ENV = 'test';
process.env.CAPTURE_YOU_TEST_MODE = 'true';

// Mock fs 确保测试不污染真实数据
const path = require('path');
const os = require('os');

// 临时目录用于测试
const TEST_TEMP_DIR = path.join(os.tmpdir(), 'capture-me-test');

// 全局测试辅助函数
global.testUtils = {
  tempDir: TEST_TEMP_DIR,

  /**
   * 生成测试用 note ID
   */
  generateId: () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

  /**
   * 清理测试数据
   */
  cleanup: async () => {
    const fs = require('fs');
    const rimraf = require('rimraf');
    if (fs.existsSync(TEST_TEMP_DIR)) {
      rimraf.sync(TEST_TEMP_DIR);
    }
  },
};

// 模拟 console.log 减少测试输出噪音
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeAll(() => {
  // 可以在这里 quiet 掉一些不重要的日志
});

afterAll(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});
