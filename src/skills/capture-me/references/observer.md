# Observer Mode

多 Agent 共用的信号收集核心库：8 个信号维度、OpenClaw 集成、CLI、失败处理。

## 被动观察模式（Observer）

### 架构设计

capture-me 的被动观察是一个**多 Agent 共用的信号收集核心库**，不同 Agent 通过各自的 hook 机制调用。

```
┌─────────────────────────────────────────────────────────────┐
│                    各 Agent Hook 实现                        │
├─────────────────────────────────────────────────────────────┤
│  OpenClaw Hook    → message:preprocessed 事件              │
│  Claude Code Hook → post-processing hook                   │
│  Codex Hook       → post-response hook                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              capture-me 核心库                             │
│  observe-core.js                                          │
│  ├── extractSignals(text, source) → 信号[]                │
│  ├── analyzeAndStore(text, source) → 同步写入              │
│  └── analyzeAndStoreAsync(text, source) → 异步静默写入    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              profile_signals 表                             │
│  ~/.claude/skills/capture-me/sqlite/capture.db             │
└─────────────────────────────────────────────────────────────┘
```

### 信号维度（8个）

| 维度 | 说明 | 触发词示例 |
|------|------|-----------|
| work | 工作相关信息 | 开会、项目、加班、老板 |
| life | 日常生活 | 吃饭、购物、出行、休息 |
| habit | 习惯行为 | 每天、熬夜、习惯、早起 |
| emotion | 情绪状态 | 开心、焦虑、累、兴奋 |
| preference | 偏好倾向 | 喜欢、讨厌、希望、想要 |
| goal | 目标计划 | 目标、打算、计划、决定 |
| relation | 人际关系 | 老婆、同事、朋友、家人 |
| health | 健康状态 | 睡眠、运动、身体、疲惫 |

### OpenClaw 集成

OpenClaw Hook 位于：`~/.openclaw/hooks/capture-me-observer/`

```javascript
// handler.js — OpenClaw Hook
const { spawn } = require('child_process');
const path = require('path');

async function handler(event) {
  if (event.type !== 'message' || event.action !== 'preprocessed') return;
  
  const { content, conversationId } = event.context || {};
  if (!content || content.trim().length < 3) return;

  spawn('node', [
    path.join(CAPTURE_ME_DIR, 'observe-async.js'),
    JSON.stringify({ text: content, source: 'openclaw', conversation_id: conversationId })
  ], { detached: true, stdio: 'ignore' }).unref();
}
```

### CLI 用法

```bash
# 分析文本
node observe-core.js "我最近工作压力很大"

# 查看统计
node observe-core.js --stat

# 重试失败队列
node observe-core.js --retry
```

### 失败处理

- 异步写入失败时，暂存到 `queue/failed-*.json`
- 日志记录到 `logs/observe-*.log`
- 可手动运行 `--retry` 重试

---
