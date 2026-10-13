# 成果管理实施计划

> For agentic workers: use superpowers:subagent-driven-development task by task, with independent review.

Goal: 人能完整维护成果，运行时完全移除 JSON 内容清单。Architecture: Django 规范化对象/关系与发布快照，复用附件预览和会话/API Key，React 管理页及展厅。Tech stack: Django/DRF/PostgreSQL、React/TypeScript。Spec: DESIGN.md。

Global constraints: 不改现有任务业务字段；不硬编码 workspace、分类或任务 ID；导入历史配置只在显式管理命令；禁止生产测试写任务；全部 UI 中文；文件预览和存储仅保留一个实现。

Review focus: 跨工作区管理员与私有项目来源；草稿污染发布版；过期写覆盖；软删除素材和修订回放；上传存储失败孤儿状态。各项都须在后端测试中有允许与拒绝或失效场景。

## Task 1 后端与迁移

Owned: apps/api/plane/db/models/artifact.py、db/migrations/0124_artifact_management.py、db/management/commands/import_artifacts.py、app/services/artifacts/\*、app/views/artifact.py、api/views/artifact.py、app/views/gallery.py、app/views/attachment_preview.py（公共预览提取）、models/asset.py、相关 urls/model 导出、API 单元测试、archive 历史清单。

- [x] 先写服务/接口行为测试，包含 DESIGN 必须证明属性。
- [x] 实现规范化模型、权限、typed 输入校验、版本锁与发布快照、CRUD、分类、选择器、上传。
- [x] 改展厅只读数据来源为 DB；删除运行时清单；历史导入 dryrun/apply/idempotence。
- [x] 隔离数据库跑 migrations 与测试，记录精确输出。
- [x] 独立代码评审，修完严重问题，再进入 UI。

Produces: DESIGN API 契约，接口 schema 示例与可复用业务服务。Consumes: 现有 FileAsset、Issue、成员、S3、公共预览。

## Task 2 人的 UI

Owned: apps/web/core/components/artifacts/\*、services/artifact.service.ts、helpers/artifact.ts、gallery 页面拆分与稳定详情/管理路由、UI 测试。

- [x] 写条件/版本/主操作 helper 测试。
- [x] 展厅新增维护入口和详情编辑入口；管理页列表、表单、任务/材料选择、上传、分类管理、版本恢复。
- [x] 保存/发布/撤下/删除清晰区分；请求失败和 409 保留输入；访问无权限入口明确。
- [x] 类型/格式/lint/build；实际浏览器完整生命周期截图。
- [x] 独立评审 UI 与 API 集成。

## Task 3 集成发布

Owner: root; docs/scripts/QA 部署与回读。

- [x] 捕获原14项和任务数据基线；构建隔离候选镜像；隔离数据库完整后端与权限测试；浏览器候选环境生命周期。
- [x] 独立最终评审、变异验证至少权限和发布规则测试敏感性。
- [x] pg_dump、配置备份、显式导入14项；DB readback；固定 SHA 镜像切换；生产截图、成员入口验证及任务指纹。
- [x] 清理自身临时成果/会话/测试 DB/容器；正式文档与源码提交推送；记录剩余边界，不声称实现代码运行环境。

Ruling: 用户已明确要求按讨论方向开发且直接修正不合理实现；不再重复请求设计/执行许可。独立 worktree，任务顺序执行，专属文件所有权避免冲突。

Spec review 2026-10-13: 五项权限/版本/导入裁定写入 DESIGN.md；已告知 Task 1，属于授权范围内的规则澄清。无需增加外部依赖或审批流。
