# 工作项共享模板

范围：项目内共享的描述模板。项目成员使用，项目或工作区管理员维护（管理员也必须属于项目）。默认模板只应用到空白新任务，不改已有任务、草稿或复制任务；切换时选择替换描述、保留并追加或取消。

入口：新建工作项 → 模板 → 管理模板。支持富文本和表格、新建、编辑、复制、删除、设置默认、将当前描述保存为模板，以及推荐给项目成员。推荐不自动分配负责人。负责人、状态、优先级、日期、成果附件仍用实际任务的原生字段；模板不保存固定日期或上传附件。

预制：通用任务、资料与流程交付、工具与系统交付、申报与答辩、待决策事项。参考真实任务和用户样例的表格结构，五个模板全部可编辑。周报继续使用页面或视图，避免重复任务内容。

## AI / API

公开 API 使用 `X-API-Key`：

- `GET/POST /api/v1/workspaces/{slug}/projects/{project_id}/work-item-templates/`
- `GET/PATCH/DELETE /api/v1/workspaces/{slug}/projects/{project_id}/work-item-templates/{id}/`

浏览器会话路径相同但前缀为 `/api/workspaces/`。列表响应 `{results, can_manage}`。

创建字段：`name`、`description_html`、`recommended_member_ids`（项目成员 UUID 列表）、`is_default`、可选稳定 `key`。更新须传当前 `version`，编辑冲突返回409。模板 HTML 经服务器清洗，模板上限100KB。默认模板每项目最多一个；删除默认后新建任务为空白，直到设置新默认。

安装预制内容：

```sh
python bokang/templates/install-seed.py --base-url http://172.16.8.31:5110 --key-file /path/to/private-api.key
```

按 key 幂等安装缺少的模板，不覆盖团队编辑，也不替换已有默认。

## 部署与回滚

后端使用 `bokang/Dockerfile.templates-api`，基于原 v1.4.2 仅覆盖模板代码和项目路由；数据库迁移0123只新增独立模板表。前端按既有构建方式构建web。迁移前备份数据库，后端和web切换到对应版本。

回滚恢复旧镜像即可，保留新增模板表和模板数据。不要逆向迁移删除模板表；已有任务与模板没有关联，不因模板修改或删除而变化。
