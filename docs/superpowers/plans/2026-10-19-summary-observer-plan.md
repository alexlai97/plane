# Summary Observer Implementation Plan

**Goal:** Deliver the approved reusable permission preset and scoped summary reader, then provision and verify Shi Haili's intranet account.
**Architecture:** Normalized membership scope, independent capability preset, central authenticated enforcement, fixed summary projection of existing views, and existing artifact publication authorization. Default existing members to standard.
**Spec:** ../specs/2026-10-19-summary-observer-design.md

- [x] Policy foundation: membership preset + normalized scope migration, cached service, declarative app/API guard, capability endpoint, protected assignment fields; paired permission tests.
- [x] Summary/publication data: reuse actual saved filters/order/tree semantics; fixed safe projection; scope protection; published artifact/material access independent from task details; deny bypass tests.
- [x] UI: policy bootstrap fail closed, observer shell and safe view reader, independent hierarchy expand, source references without detail links; account self-password path retained.
- [x] Independent authorization/design review and negative-test audit, existing role regression tests, type/lint/build checks.
- [x] Isolated production-snapshot staging: migration + real password login, viewer/navigation and direct API allow/deny, ordinary member regression, screenshots.
- [x] Production backup/deploy/migrate, provision normalized grants for shihaili@yijianfit.com, verify actual account without changing business tasks; deliver initial credentials privately in chat and record outcome without storing password in git, test logs, or reports.

No package installs or dependency changes. No production account provisioning before the permission boundary passes. No hardcoded user/workspace IDs or filter rules in product code.

实施补充：固定汇总读模型复用既有 filters/rich_filters/order_queryset；原数字角色保留，CLI 原子替换 grants。发布材料与源任务详情分别授权，预览 ticket 重新验证当前权限；受限 UI bootstrap 不加载普通任务管理 stores。完整验证证据保存在 workspace artifacts/summary-observer-20261019（含私有凭据文件，禁止提交）。

验收结果（2026-10-19）：运行代码 f35a02f，迁移 0128 已应用；78 项后端、66 项前端、TS 和生产构建通过。隔离副本及正式账号完成密码登录、共享视图/层级、发布成果、头像、材料范围读取、直接详情拒绝验证；原成员看板/任务详情/成果草稿回归通过。正式账号为 Guest + summary_observer，授权 1 个正式项目和 5 个共享视图；现有 4 名成员保持 standard。正式 API 验证窗口无 5xx，真实发布材料读取及草稿材料拒绝均符合预期。已撤销测试登录会话并清理隔离测试资源；备份与旧镜像保留。
