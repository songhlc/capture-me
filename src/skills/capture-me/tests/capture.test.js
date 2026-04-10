/**
 * capture.js 单元测试
 */

const path = require('path');

// 加载被测试模块
const capturePath = path.join(__dirname, '../capture.js');
const capture = require(capturePath);

describe('capture.js - 时间解析', () => {
  describe('parseDeadline', () => {
    test('识别"今天"并返回有效日期', () => {
      const result = capture.parse('今天要完成方案');
      expect(result.deadline).toBeDefined();
      expect(result.deadline).toBeInstanceOf(Date);
    });

    test('识别"明天"并返回明天日期', () => {
      const result = capture.parse('明天给张总打电话');
      expect(result.deadline).toBeDefined();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(result.deadline.getDate()).toBe(tomorrow.getDate());
    });

    test('识别"下周"', () => {
      const result = capture.parse('下周要评审');
      expect(result.deadline).toBeDefined();
    });

    test('无时间词时返回 null', () => {
      const result = capture.parse('这个想法不错');
      expect(result.deadline).toBeNull();
    });
  });
});

describe('capture.js - 承诺识别', () => {
  describe('isPromise', () => {
    test('识别"给某人发邮件"', () => {
      const result = capture.parse('给张总发邮件确认合同');
      expect(result.isPromise).toBe(true);
    });

    test('识别"帮某人做"', () => {
      const result = capture.parse('帮李总准备材料');
      expect(result.isPromise).toBe(true);
    });

    test('识别"记得"', () => {
      const result = capture.parse('记得跟进这个项目');
      expect(result.isPromise).toBe(true);
    });

    test('识别"答应"', () => {
      const result = capture.parse('答应王总周三给回复');
      expect(result.isPromise).toBe(true);
    });

    test('普通陈述句不是承诺', () => {
      const result = capture.parse('今天天气真好');
      expect(result.isPromise).toBe(false);
    });
  });

  describe('extractPromiseTarget', () => {
    test('提取"给张总"中的张总', () => {
      const result = capture.parse('给张总发邮件');
      expect(result.target).toBe('张总');
    });

    test('提取"帮李总"中的李总', () => {
      const result = capture.parse('帮李总做汇报');
      expect(result.target).toBe('李总');
    });
  });

  describe('extractAction', () => {
    test('提取核心动作', () => {
      const result = capture.parse('给张总发邮件确认合同');
      expect(result.action).toBeTruthy();
      expect(result.action.length).toBeGreaterThan(0);
    });
  });
});

describe('capture.js - 标签识别', () => {
  describe('inferTags', () => {
    test('识别工作标签', () => {
      const result = capture.parse('今天要开项目会议');
      expect(result.tags).toContain('@work');
    });

    test('识别邮件标签', () => {
      const result = capture.parse('给客户发邮件');
      expect(result.tags).toContain('@work/email');
    });

    test('识别投资标签', () => {
      const result = capture.parse('看了看股票行情');
      expect(result.tags).toContain('@investment');
    });

    test('识别健康标签', () => {
      const result = capture.parse('最近睡眠不太好');
      expect(result.tags).toContain('@health');
    });

    test('承诺添加 @promise 标签', () => {
      const result = capture.parse('给张总发邮件确认合同');
      expect(result.tags).toContain('@promise');
    });

    test('无明确分类时默认 @life', () => {
      const result = capture.parse('晚上吃什么好呢');
      expect(result.tags).toContain('@life');
    });
  });
});

describe('capture.js - 路由决策', () => {
  test('有截止日期路由到 apple-reminder', () => {
    const result = capture.parse('明天要给张总打电话');
    expect(result.route).toBe('apple-reminder');
  });

  test('承诺无截止日期路由到 promises', () => {
    const result = capture.parse('记得跟进项目进展');
    expect(result.route).toBe('promises');
  });

  test('一般记录路由到 capture-log', () => {
    const result = capture.parse('今天天气不错');
    expect(result.route).toBe('capture-log');
  });
});

describe('capture.js - formatReport', () => {
  test('生成标准输出格式', () => {
    const result = capture.parse('给张总发邮件确认合同');
    const report = capture.formatReport(result);

    expect(report).toContain('✓ 已捕获');
    expect(report).toContain('内容：');
    expect(report).toContain('标签：');
  });

  test('承诺显示提取的承诺内容', () => {
    const result = capture.parse('给张总发邮件确认合同');
    const report = capture.formatReport(result);

    expect(report).toContain('提取承诺：');
  });
});
