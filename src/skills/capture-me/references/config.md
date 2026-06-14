# Config

capture-me 配置文件 config.yaml 完整示例。

## 配置文件（config.yaml）

```yaml
capture-me:
  data_dir: ~/.claude/skills/capture-me
  memory_dir: memory  # 用户数据目录

  reminders:
    list_name: 提醒
    default_time: "09:00"

  ai:
    enabled: true
    model: claude-sonnet-4-20250514
    summarization: true
    entity_extraction: true

  storage:
    markdown: true
    sqlite: true
    sqlite_path: ~/.claude/skills/capture-me/sqlite/capture.db

  personality:
    enabled: true
    update_interval: daily  # daily | weekly

  categories:
    - work
    - life
    - health
    - idea
    - todo
    - goal
    - investment
```

---
