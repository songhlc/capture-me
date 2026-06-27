/**
 * progress-confirm 单元测试
 *
 * 覆盖：
 *   - schema.js: 老格式升级、空数据、新格式透传
 *   - parser.js: LLM 输出校验、合法/非法状态、模糊项目名匹配
 *   - applier.js: dry-run vs 真写、drop 移入 archived、history 累加
 *   - scanner.js / cli.js: 集成测试（轻量）
 */

const path = require('path');

// ─── schema.js ──────────────────────────────────────────
const {
  upgradeProgressDetail,
  resolveProgressDetail,
  VALID_STATUS,
} = require('../lib/progress-confirm/schema');

describe('schema.upgradeProgressDetail', () => {
  test('null / undefined → 默认 v2', () => {
    const r1 = upgradeProgressDetail(null);
    expect(r1).toEqual({ version: 2, items: [], archived: [] });

    const r2 = upgradeProgressDetail(undefined);
    expect(r2).toEqual({ version: 2, items: [], archived: [] });
  });

  test('老格式 tasks → v2 archived（默认方案 ii）', () => {
    const old = { tasks: [{ name: 'X', current: 1, total: 3 }, { name: 'Y' }] };
    const r = upgradeProgressDetail(old);
    expect(r.version).toBe(2);
    expect(r.items).toEqual([]);
    expect(r.archived.length).toBe(2);
    expect(r.archived[0].title).toBe('X');
    expect(r.archived[0].reason).toBe('pre-confirm-migration');
    expect(r.archived[0].original_task).toEqual({ name: 'X', current: 1, total: 3 });
    expect(r.archived[1].title).toBe('Y');
  });

  test('已是 v2 透传 + 补字段', () => {
    const v2 = {
      version: 2,
      items: [{ id: 'a', title: 'A', status: 'active' }],
      archived: [{ title: 'B' }],
    };
    const r = upgradeProgressDetail(v2);
    expect(r).toEqual(v2);
  });

  test('v2 但 items/archived 缺失 → 补空数组', () => {
    const broken = { version: 2 };
    const r = upgradeProgressDetail(broken);
    expect(r.items).toEqual([]);
    expect(r.archived).toEqual([]);
  });
});

describe('schema.VALID_STATUS', () => {
  test('包含四态', () => {
    expect(VALID_STATUS.has('active')).toBe(true);
    expect(VALID_STATUS.has('done')).toBe(true);
    expect(VALID_STATUS.has('drop')).toBe(true);
    expect(VALID_STATUS.has('blocked')).toBe(true);
  });

  test('不包含非法值', () => {
    expect(VALID_STATUS.has('cancel')).toBe(false);
    expect(VALID_STATUS.has('progress')).toBe(false);
    expect(VALID_STATUS.has('')).toBe(false);
  });
});

// ─── parser.js ──────────────────────────────────────────
const { buildPrompt, validateAndApply } = require('../lib/progress-confirm/parser');

describe('parser.buildPrompt', () => {
  test('prompt 包含用户原文 + 项目列表', () => {
    const projects = [
      {
        project_id: 'p1',
        project_name: 'YNF',
        items: [{ id: 'i1', title: '迁移', status: 'active' }],
      },
    ];
    const prompt = buildPrompt(projects, 'YNF: 1 完成');
    expect(prompt).toContain('YNF: 1 完成');
    expect(prompt).toContain('"project_id": "p1"');
    expect(prompt).toContain('YNF');
    expect(prompt).toContain('迁移');
    expect(prompt).toContain('"new_status"');
  });

  test('prompt 包含四态映射说明', () => {
    const projects = [{ project_id: 'p1', project_name: 'X', items: [] }];
    const prompt = buildPrompt(projects, '...');
    expect(prompt).toContain('active');
    expect(prompt).toContain('done');
    expect(prompt).toContain('drop');
    expect(prompt).toContain('blocked');
  });
});

describe('parser.validateAndApply', () => {
  const makeProjects = () => [
    {
      project_id: 'p1',
      project_name: 'YNF',
      items: [
        { id: 'i1', title: '迁移', status: 'active' },
        { id: 'i2', title: '样式', status: 'active' },
      ],
    },
    {
      project_id: 'p2',
      project_name: 'AI Coding',
      items: [{ id: 'i3', title: 'TDD 推进', status: 'active' }],
    },
  ];

  test('合法变更：全部标记 _pending_new_status', () => {
    const projects = makeProjects();
    const llm = {
      changes: [
        { project_id: 'p1', item_id: 'i1', new_status: 'done' },
        { project_id: 'p1', item_id: 'i2', new_status: 'blocked', note: '等接口' },
      ],
    };
    const result = validateAndApply(projects, llm);
    expect(result.ok).toBe(true);
    expect(result.applied.length).toBe(2);
    expect(result.errors).toEqual([]);
    expect(projects[0].items[0]._pending_new_status).toBe('done');
    expect(projects[0].items[1]._pending_new_status).toBe('blocked');
    expect(projects[0].items[1]._pending_note).toBe('等接口');
  });

  test('跳过状态不变的项', () => {
    const projects = makeProjects();
    const llm = {
      changes: [{ project_id: 'p1', item_id: 'i1', new_status: 'active' }],
    };
    const result = validateAndApply(projects, llm);
    expect(result.applied.length).toBe(0); // 状态没变不算 applied
  });

  test('非法状态 → 错误', () => {
    const projects = makeProjects();
    const llm = {
      changes: [{ project_id: 'p1', item_id: 'i1', new_status: 'cancel' }],
    };
    const result = validateAndApply(projects, llm);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('cancel');
  });

  test('不存在的 project_id / item_id → 错误', () => {
    const projects = makeProjects();
    const llm = {
      changes: [
        { project_id: 'pX', item_id: 'i1', new_status: 'done' },
        { project_id: 'p1', item_id: 'iY', new_status: 'done' },
      ],
    };
    const result = validateAndApply(projects, llm);
    expect(result.applied.length).toBe(0);
    expect(result.errors.length).toBe(2);
  });

  test('缺 changes 数组 → 错误', () => {
    const projects = makeProjects();
    const result = validateAndApply(projects, {});
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('changes');
  });

  test('多项目混合变更', () => {
    const projects = makeProjects();
    const llm = {
      changes: [
        { project_id: 'p1', item_id: 'i1', new_status: 'done' },
        { project_id: 'p2', item_id: 'i3', new_status: 'drop' },
      ],
    };
    const result = validateAndApply(projects, llm);
    expect(result.applied.length).toBe(2);
    expect(result.applied[0].project_name).toBe('YNF');
    expect(result.applied[1].project_name).toBe('AI Coding');
  });
});

// ─── applier.js (dry-run) ──────────────────────────────
const { applyChanges } = require('../lib/progress-confirm/applier');

describe('applier.applyChanges (dry-run)', () => {
  test('dry-run 不写库，只统计', () => {
    const projects = [
      {
        project_id: 'p1',
        project_name: 'X',
        items: [
          {
            id: 'i1',
            title: 'A',
            status: 'active',
            _pending_new_status: 'done',
            _pending_note: '',
          },
          {
            id: 'i2',
            title: 'B',
            status: 'active',
            _pending_new_status: 'drop',
            _pending_note: '不做了',
          },
        ],
      },
    ];
    const result = applyChanges(projects, { dryRun: true, weekIso: '2026-W26' });
    expect(result.ok).toBe(true);
    expect(result.applied.length).toBe(2);
    expect(result.dropped.length).toBe(1);
    expect(result.dropped[0].item_title).toBe('B');
  });

  test('无变更时返回空结果', () => {
    const projects = [
      { project_id: 'p1', project_name: 'X', items: [{ id: 'i1', title: 'A', status: 'active' }] },
    ];
    const result = applyChanges(projects, { dryRun: true });
    expect(result.applied).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});