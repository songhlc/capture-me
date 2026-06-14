# Architecture

目录结构、OpenClaw Hook、OpenClaw Cron 部署说明。

## 实现文件（Skill 规范结构）

```
capture-me/
├── SKILL.md              # Skill 元数据
├── README.md             # 项目说明
├── ROADMAP.md           # 开发路线图
├── package.json         # npm 配置
├── config.yaml          # 配置文件
├── bin/                  # CLI 入口
│   ├── capture-me       # 主命令
│   ├── trigger          # 触发检查
│   ├── observe-core     # 观察统计
│   └── dashboard        # 仪表盘
├── lib/                  # 功能模块
│   ├── capture.js       # 记录解析主逻辑
│   ├── db.js            # SQLite 操作
│   ├── mirror.js        # 认知镜子（承诺追踪）
│   ├── review.js        # 周报/月报生成
│   ├── profile.js       # 性格画像生成
│   ├── personality.js   # 大五人格 + MBTI + SDT
│   ├── brainstorm.js    # 头脑风暴引擎
│   ├── blindspot.js     # 盲区探测
│   ├── trigger.js       # 主动触发引擎
│   ├── observe-core.js  # 被动观察核心库
│   ├── observe-async.js # 异步观察写入
│   ├── external-data.js # 外部数据接入
│   ├── config.js       # 配置管理
│   ├── dashboard.js    # Web 仪表盘
│   ├── stat.js          # 统计信息
│   ├── query.js        # 搜索查询
│   ├── setup.js        # 初始化引导
│   ├── projects.js     # 项目管理
│   └── achievements.js # 成就系统
├── scripts/             # 工具脚本
│   ├── init-db.sh
│   ├── install.sh
│   └── check-todos.js
├── references/          # 参考文档
│   └── HOOK-INTEGRATION.md  # Hook 集成说明
├── sqlite/             # 数据库
│   └── capture.db
├── memory/             # 用户数据
├── templates/          # 模板文件
├── logs/              # 日志
└── queue/             # 失败队列
```

### OpenClaw Hook（独立部署）

```
~/.openclaw/hooks/capture-me-observer/
├── HOOK.md           # Hook 元数据
├── handler.js       # OpenClaw 事件处理
└── write-signals.js # 异步写入（调用 capture-me/lib/observe-async.js）
```

Hook 调用关系：
```
OpenClaw message:preprocessed
    ↓
handler.js (OpenClaw Hook)
    ↓
observe-async.js (capture-me/lib)
    ↓
profile_signals 表 (capture-me/sqlite/capture.db)
```

### OpenClaw Cron（定时任务）

```
~/.openclaw/cron/
e14a590f-f43b-45ee-b324-e503eaf29c75
  name: capture-me-daily-trigger
  schedule: 0 9 * * * @ Asia/Shanghai
  command: node .../bin/trigger check
```

---
