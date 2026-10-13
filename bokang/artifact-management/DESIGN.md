# 成果管理重构设计

用户已确认：人的 CRUD 是首要能力；正式成果对象可复用；允许直接修正不合理实现，清除运行时收录清单，不再每次更新内容都发布镜像。保持现有工作区、任务、附件、预览与内网部署。

## 已实现且复用

| 现有能力                 | 来源                                         | 处理                                                        |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------- |
| 工作区、项目、任务与成员 | db/models/workspace.py、project.py、issue.py | 不改业务字段，来源任务多对多引用                            |
| 文件及 S3 存储           | db/models/asset.py、settings/storage.py      | 复用 FileAsset，增加成果附件实体类型                        |
| 文档、图片、音视频预览   | app/views/attachment_preview.py              | 提取接受已授权 asset 的公共预览函数；所有调用先执行自身权限 |
| 展厅与材料详情           | web gallery/page.tsx                         | 保留入口与风格，新增人的维护流程                            |
| 会话及 API Key 认证      | app/views/base.py、api/views/base.py         | 两种入口调用同一业务服务                                    |

机械盘点见 inventory.json：343 路由、86 表、59 页面。现有 gallery 路由、页面和 FileAsset 修改；其他既有登录、任务、模板、视图、通知等入口不更改业务行为。新增成果、分类、来源、材料、修订表及管理路由。回归覆盖任务跳转、材料预览、原展厅 14 项与权限拒绝。

## 模型与生命周期

Artifact：UUID、workspace、owner、title、summary、kind（自由短文本）、category（可空 FK）、cover_asset（可空 FK）、primary action、version（乐观并发）、published_revision（可空 FK）、access=private/workspace（默认 private）、status=draft/published/withdrawn、created/updated/deleted。业务分类为数据库数据，不做枚举、不固定部门。

ArtifactSource：Artifact / Issue FK，唯一关联；ArtifactMaterial：Artifact / FileAsset 可空 FK、URL、title、link kind、排序。一个成果可有多材料、多任务。ArtifactRevision：Artifact、递增版本、不可变内容快照、actor、created。快照固定展示修订和引用，不承诺冻结外部网站或文件字节。

保存仅改草稿。发布经材料、来源、封面、主操作校验后生成快照；后续草稿改动不影响已发布内容。撤下停止展厅展示。恢复修订仅恢复草稿，必须再发布。删除软删除成果，保留审计/修订，绝不级联删除共享文件或任务。需要 version 的改写缺失返回 400，过期返回 409。

权限：活动工作区 ADMIN/MEMBER 可创建，私有草稿仅所有者或 ADMIN 可改；已发布后 access 明确转 workspace，活动 MEMBER/ADMIN 可协作改/发布/撤下/删除；撤下不改变 access；GUEST 只能读已发布成果。分类活动 MEMBER/ADMIN 可维护，已被成果或修订使用时禁止删除。任务来源与素材始终检查同一 workspace 和所有来源项目访问；API Key 不越过角色/项目范围。未授权来源成果整体不可见，不泄露标题摘要。独立成果可无来源任务，但必须有可用材料或链接才可发布。成果自己上传的文件须绑定成果实体；同 workspace 的其他人不可借资产 ID 使用不属于自己的私有草稿文件。

## 人的体验

展厅右上角「管理成果」「新建成果」，保持领导浏览页面简洁。管理页提供全部可维护成果、状态、未发布修改标识、搜索、分类和操作。

创建/编辑表单：名称、简短说明、类型、分类；关联任务（搜索/多选）、从任务挑材料、添加链接；可直接上传文件（创建草稿后启用上传）；选择封面及主操作。保存草稿、预览、发布按钮明确分开。已有成果从详情可编辑；撤下、删除需具体确认；错误就地提示，409 保留本地编辑并提示重新加载。

分类独立管理：新增/改名/删除，名称必填，重复拒绝，删除被使用分类提示原因。版本面板列出修订时间与操作者，可查看并恢复为草稿。稳定详情地址 /<workspace>/gallery/<artifact UUID>/；发布版本与草稿视图分开。

## API 契约

会话前缀 /api/workspaces/<slug>/artifacts/，API Key 前缀 /api/v1/workspaces/<slug>/artifacts/。GET 列表 query scope=published|manage（默认 published），search；返回 {results, count, can_create}。结果保持 GalleryCard 的 sources/attachments/links/cover/primary_action，增加 category_id/owner_id/status/version/published_version/has_unpublished_changes/can_edit。category 为名称；id 统一 UUID。

POST 创建草稿；/<id>/ GET query view=draft|published（默认 published）、PATCH、DELETE。write body 为 {title,summary,kind,category_id,source_issue_ids,assets:[{id}],links:[{title,url,kind}],cover_asset_id,primary_action:{type:detail|attachment|link,label,attachment_id?,url?},version（创建时省略，其余写必填）}。服务推导 entity_type，不相信客户端。

/<id>/publish/ POST {version}；withdraw/ POST {version}；revisions/ GET；revisions/<revision_id>/restore/ POST {version}。类别 /artifact-categories/ GET {results,can_manage}、POST；/<id>/ PATCH/DELETE，返回 id/name/usage_count/version；写要求 version。

选择器 /artifact-sources/?search= 返回可访问任务 {id,identifier,name,project_id}；/<issue_id>/materials/ 返回有效可用附件/描述/评论文件，供用户选择。上传 /artifacts/<id>/uploads/ POST multipart file，仅所有者/admin；复用存储限额与预览，上传成功返回可选材料，不自动发布。所有下载与预览先检查成果版本及素材访问。

原 /gallery/ GET 保留展示入口，数据完全来自数据库发布快照；categories 是当前分类名称；stats 按可见成果和实际演示材料计算。gallery assets/covers 不再依赖 JSON 白名单，基于有权限的成果/修订引用。

## 迁移与 clean break

现有 gallery.json 移到仅用于一次导入的 archive，运行时不读取、不做 fallback。通用 import_artifacts 命令显式 --workspace --owner --input，默认 dry run；apply 在事务中校验、导入类别、14 个成果及已发布修订，重复运行无重复。现有派生封面跟随 Asset ID 保留，权限检查引用数据库。所有部署数据更新以后由人的 CRUD 完成，不再重建镜像。

## 必须证明的属性

两个 workspace 的管理员跨租户 ID 拒绝；同租户私有项目/素材拒绝；所有者写与普通成员读的允许/拒绝配对；草稿不进展厅、保存不改发布版；版本冲突；恢复修订仍需发布；共享文件删除不跟随成果；来源/资产软删除失效；无材料发布拒绝；安全 URL；上传大小/存储失败与绑定；原14项迁移无重复且任务数据指纹不变。

生产前隔离数据库测模型/服务/接口和迁移；真正浏览器执行新建→编辑→材料选择→保存→预览→发布→刷新→撤下→恢复→删除及分类改名。真实截图查看效果。生产迁移前 pg_dump、配置/清单备份；同一次发布先迁移数据再切换读取；保留旧镜像和数据库回滚路径。

## 评审裁定

1. 仅创建可不传 version；所有已有对象写（含删除/发布/撤下/恢复/分类修改）要求 version，事务锁内检查并推进。
2. owner 默认创建者且只读，不在首版做转交权限。
3. 新成果上传的预览和转换 source token 绑定 actor、artifact/revision、asset；读取时重新校验，不能只凭 asset UUID，仍复用公共渲染。
4. 快照冻结内容与引用选择，材料可用性和项目权限实时校验。失效引用返回 unavailable_reference_count，不静默忽略；所有者/admin 可修复自己的草稿，不能读取无权限素材或发布无效引用；恢复遇失效引用明确拒绝。
5. 导入 ID=UUID5(workspace UUID, 历史 card key)，同一输入重复跳过；不同输入或已有人工改动拒绝，禁止覆盖。没有运行时 legacy key/fallback。

6. 人的协作裁定：旧14项若全部导入到单一 owner，其他成员不能维护，违背本次目标。Artifact 增加明确 access=private/workspace；初始私有，首次发布转工作区协作。撤下不撤销编辑权；访客始终只读已发布版本。访问仍受全部来源项目限制，不能因工作区成员角色泄露私有来源。owner 是只读归属，不是共享成果的唯一编辑者。

Implementation rulings: PATCH omits preserve fields; explicit empty/null clears. Preview conversion uses server-configured internal API origin (default Docker api), permitting isolated verification without reading production DB. Legacy JSON runtime tests/build recipe removed; canonical lifecycle tests replace them.

Source scope integrity: ArtifactSource retains exact project UUID independently of nullable Issue FK; validated writes refresh this authorization cache from a live Issue. Removing an Issue never borrows permissions from a different publication. Unknown legacy orphan scope denies access; exact known scope permits authorized repair. Restore preserves current publication/withdrawn status; only publish affects the displayed revision. Draft asset view uses path-scoped resources so iframe child requests keep draft authorization.
