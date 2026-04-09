# 知己 / Capture-You

> AI 增强型随手捕捉系统 — 你的第二大脑

[![Node.js >= 18.0.0](https://img.shields.io/badge/Node.js-%3E%3D%2018.0.0-green.svg)](https://nodejs.org/)
[![Platform: macOS](https://img.shields.io/badge/Platform-macOS-blue.svg)](https://www.apple.com/macos/)

---

## 产品定位

**知己** 是一款 AI 增强型的个人知识捕捉与管理系统。它能够帮助你：

- **随时随地捕捉** — 记录一闪而过的想法、待办事项、灵感碎片
- **自动解析分类** — AI 智能识别内容类型（待办、想法、项目、参考等）
- **定时提醒** — 自动同步到 Apple Reminders，不让任何重要事项遗漏
- **性格画像** — 分析你的行为模式，了解自己的思考习惯
- **双轨存储** — Markdown + SQLite，本地优先，永不丢失

---

## 产品亮点

| 亮点 | 说明 |
|------|------|
| **AI 智能解析** | 自动识别内容类型、提取关键词、生成标签 |
| **双存储架构** | Markdown 便于阅读，SQLite 便于查询，各取所长 |
| **Apple Reminders 集成** | 自动同步待办事项到系统提醒 app |
| **性格画像分析** | 基于捕捉记录分析你的思维模式和行为习惯 |
| **周报/月报生成** | 自动汇总一段时间内的记录，生成结构化报告 |
| **本地优先** | 所有数据存储在本地，尊重隐私 |
| **TDD 开发** | 完善的测试覆盖，保证稳定可靠 |

---

## 适合人群

- **知识工作者** — 需要频繁记录想法、整理信息的职场人士
- **项目经理** — 需要追踪待办、管理项目进展
- **学生/研究者** — 收集资料、整理笔记、规划学习
- **创作者** — 捕捉灵感、管理素材、追踪创作进度
- **任何希望提升个人效率的人** — 让你的"第二大脑"帮你记住一切

---

## 环境要求

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **macOS** (用于 Apple Reminders 集成)
- **better-sqlite3** (自动安装)

---

## 安装

### 方式一：快速安装

```bash
# 1. 进入 skill 目录
cd src/skills/capture-you

# 2. 安装依赖
npm install

# 3. 初始化数据库
npm run init

# 4. 验证安装（运行测试）
npm test
```

### 方式二：自动安装脚本

```bash
# 检查并安装所有依赖
./scripts/install.sh
```

`install.sh` 会自动检查：
- Node.js 版本
- npm 版本
- 缺失的 npm 包并自动安装
- 创建必要的目录结构

---

## 快速使用

### 记录新内容

```bash
# 基本记录
node capture.js "给张总发邮件确认合同"

# 指定类型（idea/todo/project/reference/note）
node capture.js "todo:完成项目文档" --type todo

# 指定到期时间
node capture.js "todo:提交方案" --due "2026-04-15"
```

### 搜索记录

```bash
# 关键词搜索
node query.js "张总"

# 按类型筛选
node query.js --type todo

# 按日期范围筛选
node query.js --from 2026-04-01 --to 2026-04-30
```

### 查看统计

```bash
node stat.js
```

### 生成报告

```bash
# 生成周报
node review.js week

# 生成月报
node review.js month
```

### 查看性格画像

```bash
node profile.js
```

---

## 配置文件

编辑 `config.yaml` 自定义行为：

```yaml
capture-you:
  data_dir: ~/.capture-you
  memory_dir: memory

  reminders:
    list_name: Inbox
    enabled: true

  ai:
    enabled: true
    model: claude-sonnet-4-20250514
```

---

## 数据存储

| 类型 | 路径 | 说明 |
|------|------|------|
| Markdown | `memory/capture-log.md` | 人类可读的记录文件 |
| SQLite | `sqlite/capture.db` | 结构化查询数据库 |
| 配置 | `config.yaml` | 用户配置 |
| 日志 | `~/.capture-you/logs/` | 运行日志 |

---

## 目录结构

```
capture-you/
├── SKILL.md           # Skill 定义文档
├── capture.js         # 记录解析主逻辑
├── review.js          # 周报/月报生成
├── profile.js         # 性格画像分析
├── stat.js            # 统计信息
├── query.js           # 搜索查询
├── db.js              # SQLite 操作
├── config.yaml        # 配置文件
├── package.json       # npm 配置
├── jest.config.js     # 测试配置
├── scripts/
│   ├── init-db.sh     # 初始化数据库
│   └── check-todos.js # 待办过期检查
└── tests/             # 单元测试
    ├── setup.js
    ├── capture.test.js
    ├── db.test.js
    ├── review.test.js
    ├── profile.test.js
    └── query.test.js
```

---

## 同步到 .claude

```bash
# 从项目根目录
cd ../..
./scripts/sync-skills.sh capture-you
```

---

## License

MIT
