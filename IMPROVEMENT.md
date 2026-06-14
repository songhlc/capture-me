# Capture-Me 改进计划

> 创建日期：2026-05-14

## 一、项目现状

### 1.1 项目结构

```
capture-me/
├── src/
│   ├── hooks/                    # OpenClaw Hook
│   │   ├── handler.ts/js        # 消息拦截处理器
│   │   ├── write-signals.js     # 异步写入信号
│   │   └── HOOK.md             # Hook 说明文档
│   └── skills/
│       ├── capture-me/          # 主技能（39个文件）
│       │   ├── lib/            # 核心库（capture.js/db.js等）
│       │   ├── tests/          # 测试（8套件69测试）
│       │   └── ...
│       └── capture-me-observer/ # 被动观察技能
├── tests/                       # 根目录测试（旧）
└── README.md / PRODUCT.md / ROADMAP.md
```

### 1.2 测试状态

- 69 个测试全部通过
- 测试位于 `src/skills/capture-me/tests/`
- 根目录 `tests/` 为旧测试目录（未使用）

---

## 二、待改进项

### 2.1 代码质量

| 问题 | 位置 | 说明 |
|------|------|------|
| 代码重复 | `hooks/handler.ts` vs `skills/capture-me/lib/observe-core.js` | 信号提取规则高度重复 |
| 混合 TS/JS | `hooks/` | handler.ts 编译为 handler.js，但源文件未清理 |
| 缺少 Lint | 全局 | 无 ESLint/Prettier 配置 |
| 缺少类型检查 | `hooks/` | TypeScript 未启用 strict 模式 |

### 2.2 测试覆盖

| 问题 | 说明 |
|------|------|
| 根目录 tests/ 未使用 | `tests/` 目录与 `src/skills/capture-me/tests/` 重复 |
| 缺少集成测试 | 只有单元测试，无端到端测试 |
| 缺少覆盖率报告 | 未配置 Jest coverage |
| Observer 测试缺失 | `observe-core.js` 有导出但无测试文件 |

### 2.3 工程化

| 问题 | 说明 |
|------|------|
| 无 CI/CD | 缺少 GitHub Actions 配置 |
| 无发布流程 | package.json 无 version 管理 |
| 依赖未锁定 | package-lock.json 存在但未提交 |
| 缺少 CHANGELOG | 无版本变更记录 |

### 2.4 文档

| 问题 | 说明 |
|------|------|
| 文档分散 | README/PRODUCT/ROADMAP 职责不清 |
| API 文档缺失 | lib 目录无 JSDoc |
| CLAUDE.md 未同步 | 根目录有 CLAUDE.md 但内容不完整 |

---

## 三、改进优先级

### P0 — 必须修复（影响可用性）

1. **清理重复代码** — 合并 `handler.ts` 和 `observe-core.js` 的信号规则
2. **启用 TypeScript 严格模式** — 修复 `hooks/` 目录的 TS 配置
3. **测试目录统一** — 删除根目录 `tests/`，统一到 `src/skills/capture-me/tests/`

### P1 — 应该改进（提升可维护性）

4. **添加 ESLint + Prettier** — 统一代码风格
5. **配置 Jest Coverage** — 生成覆盖率报告
6. **为 observe-core 添加测试** — 补充信号提取规则测试
7. **清理编译产物** — 删除 `hooks/handler.js`，保留源文件

### P2 — 可以做（长期价值）

8. **添加 GitHub Actions CI** — 自动化测试
9. **生成 API 文档** — 使用 JSDoc 为核心库生成文档
10. **建立 CHANGELOG 机制** — 自动化版本发布
11. **重构文档结构** — 合并 README/PRODUCT 为单一文档

---

## 四、具体行动计划

### 阶段一：代码清理（P0）

```
1. 创建 observe-core.js 单一信号规则源
2. 修改 hooks/handler.ts 引用 observe-core
3. 删除 hooks/handler.js 编译产物
4. 统一测试到 src/skills/capture-me/tests/
```

### 阶段二：质量提升（P1）

```
5. 添加 ESLint + Prettier 配置
6. 配置 Jest coverage 报告
7. 编写 observe-core.test.js
8. 启用 tsconfig strict
```

### 阶段三：工程化（P2）

```
9. 添加 .github/workflows/test.yml
10. 添加 standard-version 配置
11. 清理并完善文档
```

---

## 五、风险评估

| 改动 | 风险 | 缓解措施 |
|------|------|----------|
| 合并信号规则 | Observer 行为改变 | 保留原有规则顺序，确保向后兼容 |
| 删除旧 tests/ | 测试遗漏 | 确认根目录 tests/ 已废弃后再删 |
| 启用 strict TS | 编译失败 | 逐步启用，逐文件修复 |
