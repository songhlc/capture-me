# Work Capture

工作记录识别、工作标签体系、简化捕获流程、项目进度自动更新。

## 工作内容捕获（Work Capture）

工作相关记录的核心原则：**SQLite 为主存储，Markdown 按需写入**

### 工作记录识别

当输入包含以下特征时，自动识别为工作记录：
- 提及具体项目名（如 YNF2MDF、客户名）
- 技术术语（架构、部署、代码、API）
- 会议、汇报、邮件相关
- 进度更新、里程碑

### 工作记录标签体系

```
@work                    — 通用工作事务
@work/project/项目名     — 特定项目（如 @work/project/YNF2MDF）
@work/meeting            — 会议记录
@work/email              — 邮件相关
@work/report             — 汇报/报告
@work/followup           — 需要跟进的
@work/decision           — 决策结论
@progress/项目名         — 项目进度（如 @progress/YNF2MDF）
```

### 简化捕获流程

工作内容捕获路径（推荐）：

```
用户输入 → capture.js → SQLite(notes表) → 解析 → projects表更新
                                ↓
                         Markdown(按需)
```

**当前流程问题**：capture.js 会在捕获时同时写入 `capture-log.md` 和 `promises.md`，每次都要：
1. `ensureMemoryFiles()` — 检查/创建文件
2. `appendToCaptureLog()` — 读全文 → 找插入点 → 修改 → 写回
3. `appendToPromises()` — 读全文 → 正则替换 → 写回

**优化后的流程**：对于纯工作记录，直接写 SQLite，Markdown 同步由 `projects.js export` 统一处理。

### 项目进度自动更新

当记录包含项目名且标注进度时，自动更新 projects 表：

```
输入：YNF2MDF 扩展脚本都转完了

解析结果：
{
  "summary": "YNF2MDF扩展脚本转换完成",
  "category": "work",
  "tags": ["@work", "@work/project/YNF2MDF", "@progress/YNF2MDF"],
  "is_project_update": true,
  "project_name": "YNF2MDF",
  "project_progress_delta": +20
}
```

### 大模型解析指令（工作记录）

```json
{
  "action": "parse_capture",
  "note_id": "capture-xxx",
  "raw_text": "YNF2MDF 扩展脚本都转完了",
  "extract": {
    "summary": "一句话摘要",
    "category": "work",
    "tags": ["@work", "@work/project/项目名"],
    "entities": {...},
    "is_project_update": true/false,
    "project_name": "项目名",
    "project_progress_delta": 10,
    "is_todo": false
  }
}
```

---
