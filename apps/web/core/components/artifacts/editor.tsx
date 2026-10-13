import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { artifactService } from "@/services/artifact.service";
import {
  artifactError,
  artifactStatus,
  artifactToWrite,
  removeArtifactAsset,
  mergeArtifactWrites,
  artifactFieldLabels,
} from "../../helpers/artifact";
import type {
  Artifact,
  ArtifactAsset,
  ArtifactCategory,
  ArtifactRevision,
  ArtifactSource,
  ArtifactSnapshot,
  ArtifactMergeChoices,
  ArtifactWriteField,
  ArtifactWrite,
} from "../../helpers/artifact";
import { isSafeHttpUrl } from "../../helpers/gallery";
import { ArtifactShell, buttonClass, Field, inputClass, Message, primaryClass, Section } from "./shared";

export default function ArtifactEditorPage() {
  const uploadInput = useRef<HTMLInputElement>(null);
  const params = useParams();
  const router = useRouter();
  const slug = params.workspaceSlug?.toString() ?? "";
  const routeId = params.artifactId?.toString();
  const [artifact, setArtifact] = useState<Artifact>();
  const [form, setForm] = useState<ArtifactWrite>(artifactToWrite());
  const [baseline, setBaseline] = useState<ArtifactWrite>(artifactToWrite());
  const [mergeChoices, setMergeChoices] = useState<ArtifactMergeChoices>({});
  const [assets, setAssets] = useState<ArtifactAsset[]>([]);
  const [sources, setSources] = useState<ArtifactSource[]>([]);
  const [categories, setCategories] = useState<ArtifactCategory[]>([]);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<ArtifactSource[]>([]);
  const [materials, setMaterials] = useState<Record<string, ArtifactAsset[]>>({});
  const [revisions, setRevisions] = useState<ArtifactRevision[]>([]);
  const [revisionView, setRevisionView] = useState<ArtifactSnapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Artifact>();
  const apply = useCallback((item: Artifact) => {
    setArtifact(item);
    setForm(artifactToWrite(item));
    setBaseline(artifactToWrite(item));
    setMergeChoices({});
    setAssets(item.assets);
    setSources(item.sources);
    setConflict(false);
    setLatest(undefined);
  }, []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const cats = await artifactService.categories(slug);
        if (!active) return;
        setCategories(cats.results);
        if (routeId) {
          const item = await artifactService.detail(slug, routeId, "draft");
          if (active) apply(item);
        } else {
          const list = await artifactService.list(slug);
          if (active) setCanCreate(list.can_create);
        }
      } catch (e) {
        if (active) setError(artifactError(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [slug, routeId, apply]);
  useEffect(() => {
    if (!artifact?.can_edit) return;
    let active = true;
    artifactService
      .revisions(slug, artifact.id)
      .then((items) => {
        if (active) setRevisions(items);
        return items;
      })
      .catch((e) => {
        if (active) setError(artifactError(e));
      });
    return () => {
      active = false;
    };
  }, [slug, artifact]);
  useEffect(() => {
    if (!search.trim()) {
      setMatches([]);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      artifactService
        .sources(slug, search)
        .then((items) => {
          if (active) setMatches(items);
          return items;
        })
        .catch((e) => {
          if (active) setError(artifactError(e));
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [slug, search]);
  const change = <K extends keyof ArtifactWrite>(key: K, value: ArtifactWrite[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const fail = (e: unknown) => {
    setError(artifactError(e));
    if ((e as { response?: { status?: number } })?.response?.status === 409) setConflict(true);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const validate = () => {
    if (!form.title.trim()) throw new Error("名称必填");
    if (!form.kind.trim()) throw new Error("类型必填");
    if (form.links.some((link) => !link.title.trim() || !isSafeHttpUrl(link.url)))
      throw new Error("链接必须填写标题及有效的 http/https 地址");
  };
  const save = async (): Promise<Artifact> => {
    try {
      validate();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
    const item = await artifactService.save(
      slug,
      { ...form, ...(artifact ? { version: artifact.version } : {}) },
      artifact?.id
    );
    apply(item);
    if (!artifact) router.replace(`/${slug}/gallery/${item.id}/edit/`);
    return item;
  };
  const saveAction = (mode: "save" | "preview" | "publish") =>
    run(async () => {
      const item = await save();
      if (mode === "publish") {
        const published = await artifactService.publish(slug, item.id, item.version);
        apply(await artifactService.detail(slug, published.id, "draft"));
        setMessage("已发布，成果展厅现在展示此版本。");
      } else if (mode === "preview") {
        router.push(`/${slug}/gallery/${item.id}/?view=draft`);
        setMessage("草稿已保存。");
      } else setMessage("草稿已保存。发布后才会更新成果展厅。");
    });
  const addSource = (source: ArtifactSource) => {
    setSources((previous) => (previous.some((item) => item.id === source.id) ? previous : [...previous, source]));
    setForm((previous) => ({ ...previous, source_issue_ids: [...new Set([...previous.source_issue_ids, source.id])] }));
    setSearch("");
  };
  const addAsset = (asset: ArtifactAsset) => {
    setAssets((previous) => (previous.some((item) => item.id === asset.id) ? previous : [...previous, asset]));
    setForm((previous) => ({
      ...previous,
      assets: previous.assets.some((item) => item.id === asset.id)
        ? previous.assets
        : [...previous.assets, { id: asset.id }],
    }));
  };
  const mergeResult = latest ? mergeArtifactWrites(baseline, form, artifactToWrite(latest), mergeChoices) : undefined;
  const describeField = (field: ArtifactWriteField, value: ArtifactWrite): string => {
    if (field === "category_id") return categories.find((item) => item.id === value.category_id)?.name ?? "未分类";
    if (field === "source_issue_ids")
      return (
        value.source_issue_ids
          .map((id) => [...sources, ...(latest?.sources ?? [])].find((item) => item.id === id))
          .map((item) => (item ? `${item.identifier} · ${item.name}` : "不可用工作项"))
          .join("\n") || "无关联"
      );
    if (field === "assets")
      return (
        value.assets
          .map(({ id }) => [...assets, ...(latest?.assets ?? [])].find((item) => item.id === id)?.name ?? "不可用材料")
          .join("\n") || "无材料"
      );
    if (field === "links")
      return (
        value.links
          .map(
            (link) =>
              `${link.title} · ${{ application: "应用入口", demo: "演示", reference: "参考资料" }[link.kind]}\n${link.url}`
          )
          .join("\n\n") || "无链接"
      );
    if (field === "cover_asset_id")
      return [...assets, ...(latest?.assets ?? [])].find((item) => item.id === value.cover_asset_id)?.name ?? "无封面";
    if (field === "primary_action") {
      const action = value.primary_action;
      return `${action.label}\n${action.type === "detail" ? "成果详情" : action.type === "link" ? action.url : ([...assets, ...(latest?.assets ?? [])].find((item) => item.id === action.attachment_id)?.name ?? "不可用材料")}`;
    }
    return String(value[field] || "未填写");
  };
  const selectedAssets = assets.filter((asset) => form.assets.some((selected) => selected.id === asset.id));
  if (loading)
    return (
      <ArtifactShell slug={slug} title="成果编辑">
        <p role="status">正在加载…</p>
      </ArtifactShell>
    );
  const editable = artifact ? artifact.can_edit : canCreate;
  return (
    <ArtifactShell
      slug={slug}
      title={artifact ? `编辑成果 · ${artifact.title}` : "新建成果"}
      actions={
        <a href={`/${slug}/gallery/manage/`} className={buttonClass}>
          管理成果
        </a>
      }
    >
      <Message error={error} message={message} />
      {!editable ? (
        <p>没有维护成果的权限。</p>
      ) : (
        <>
          {artifact && (
            <div className="text-sm mb-5 flex flex-wrap items-center gap-3">
              <span>{artifactStatus[artifact.status]}</span>
              <span className="text-[#718399]">当前草稿版本 {artifact.version}</span>
              {artifact.has_unpublished_changes && <span className="text-amber-700">有未发布修改</span>}
              {artifact.status === "published" && (
                <a className="text-[#2d628b] underline" href={`/${slug}/gallery/${artifact.id}/`}>
                  查看发布成果
                </a>
              )}
              {artifact.unavailable_reference_count > 0 && (
                <span className="text-red-700">
                  有 {artifact.unavailable_reference_count} 项来源或材料已不可用，请修复后发布。
                </span>
              )}
            </div>
          )}
          {conflict && (
            <Section title="保留本地编辑，处理版本冲突">
              <p className="text-sm">先查看最新内容，再将需要保留的修改合并到当前表单。</p>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (artifact) {
                      setLatest(await artifactService.detail(slug, artifact.id, "draft"));
                      setMergeChoices({});
                    }
                  })
                }
              >
                查看最新内容
              </button>
              {latest && (
                <>
                  <p className="text-sm">
                    最新版本 {latest.version}。未在本地修改的字段会自动采用最新内容；双方修改了同一字段时，请逐项选择。
                  </p>
                  {mergeResult?.conflicts.map((field) => (
                    <div key={field} className="border-amber-200 bg-amber-50 text-sm space-y-3 rounded-md border p-4">
                      <h3 className="font-semibold">{artifactFieldLabels[field]}</h3>
                      <div className="grid gap-3 md:grid-cols-2">
                        {(["local", "latest"] as const).map((side) => (
                          <label key={side} className="space-y-2 rounded-md border border-[#dce5ef] bg-white p-3">
                            <span className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`merge-${field}`}
                                checked={mergeChoices[field] === side}
                                onChange={() => setMergeChoices((previous) => ({ ...previous, [field]: side }))}
                              />
                              {side === "local" ? "保留本地" : "采用最新"}
                            </span>
                            <p className="font-normal break-all whitespace-pre-wrap">
                              {describeField(field, side === "local" ? form : artifactToWrite(latest))}
                            </p>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {mergeResult && mergeResult.conflicts.length === 0 && (
                    <p className="text-sm text-green-800">修改涉及不同字段，可自动合并并保留双方改动。</p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button
                      className={buttonClass}
                      disabled={!mergeResult || mergeResult.unresolved.length > 0}
                      onClick={() => {
                        if (!mergeResult || mergeResult.unresolved.length) return;
                        setArtifact(latest);
                        setBaseline(artifactToWrite(latest));
                        setForm(mergeResult.merged);
                        setAssets((previous) => [
                          ...previous,
                          ...latest.assets.filter((item) => !previous.some((existing) => existing.id === item.id)),
                        ]);
                        setSources((previous) => [
                          ...previous,
                          ...latest.sources.filter((item) => !previous.some((existing) => existing.id === item.id)),
                        ]);
                        setConflict(false);
                        setLatest(undefined);
                        setMergeChoices({});
                        setError("");
                        setMessage("已按选择合并双方修改，请检查表单后保存草稿。");
                      }}
                    >
                      应用合并结果，继续编辑
                    </button>
                    <button
                      className={buttonClass}
                      onClick={() => {
                        if (window.confirm("放弃当前本地输入，载入最新草稿？")) {
                          apply(latest);
                          setError("");
                        }
                      }}
                    >
                      放弃本地输入并载入最新草稿
                    </button>
                  </div>
                </>
              )}
            </Section>
          )}
          <fieldset disabled={busy} className="mt-5 space-y-5 disabled:opacity-70">
            <Section title="基本信息">
              {!artifact && (
                <p className="text-sm text-[#718399]">
                  新建草稿仅你和工作区管理员可维护；首次发布后，工作区成员可协作维护。
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="成果名称 *">
                  <input
                    className={inputClass}
                    maxLength={240}
                    value={form.title}
                    onChange={(e) => change("title", e.target.value)}
                  />
                </Field>
                <Field label="类型 *">
                  <input
                    className={inputClass}
                    placeholder="例如：在线工具、演示、交付资料"
                    value={form.kind}
                    onChange={(e) => change("kind", e.target.value)}
                  />
                </Field>
                <Field label="分类">
                  <select
                    className={inputClass}
                    value={form.category_id ?? ""}
                    onChange={(e) => change("category_id", e.target.value || null)}
                  >
                    <option value="">未分类</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="简短说明">
                <textarea
                  className={inputClass}
                  rows={3}
                  value={form.summary}
                  onChange={(e) => change("summary", e.target.value)}
                />
              </Field>
            </Section>
            <Section title="关联工作项">
              <input
                aria-label="搜索关联工作项"
                className={inputClass}
                placeholder="输入工作项编号或名称"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search.trim() && (
                <div className="max-h-60 overflow-y-auto rounded-md border border-[#dce5ef]">
                  {matches
                    .filter((item) => !form.source_issue_ids.includes(item.id))
                    .map((item) => (
                      <button
                        type="button"
                        className="text-sm block w-full border-b border-[#e6edf4] p-3 text-left hover:bg-[#edf3f9]"
                        key={item.id}
                        onClick={() => addSource(item)}
                      >
                        {item.identifier} · {item.name} <span className="float-right">添加</span>
                      </button>
                    ))}
                  {!matches.length && <p className="text-sm p-3 text-[#718399]">暂无匹配工作项</p>}
                </div>
              )}
              {sources
                .filter((source) => form.source_issue_ids.includes(source.id))
                .map((source) => (
                  <div key={source.id} className="rounded-lg border border-[#dce5ef] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">
                        {source.identifier} · {source.name}
                      </span>
                      <div className="flex gap-2">
                        <button
                          className={buttonClass}
                          onClick={() =>
                            void run(async () => {
                              const items = await artifactService.materials(slug, source.id);
                              setMaterials((previous) => ({ ...previous, [source.id]: items }));
                            })
                          }
                        >
                          选择工作项材料
                        </button>
                        <button
                          className={buttonClass}
                          onClick={() => {
                            change(
                              "source_issue_ids",
                              form.source_issue_ids.filter((id) => id !== source.id)
                            );
                            setMessage("关联已移除。工作项材料仍可能已选中；如不再保留来源，请同时移除其材料后保存。");
                          }}
                        >
                          移除关联
                        </button>
                      </div>
                    </div>
                    {materials[source.id] && (
                      <div className="mt-3 space-y-2">
                        {materials[source.id].map((item) => (
                          <label className="text-sm flex items-center gap-2" key={item.id}>
                            <input
                              type="checkbox"
                              checked={form.assets.some((asset) => asset.id === item.id)}
                              onChange={(e) => {
                                if (e.target.checked) addAsset(item);
                                else setForm((previous) => removeArtifactAsset(previous, item.id));
                              }}
                            />
                            {item.name}
                          </label>
                        ))}
                        {!materials[source.id].length && (
                          <p className="text-sm text-[#718399]">该工作项没有可用材料。</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </Section>
            <Section title="成果材料">
              <div className="space-y-2">
                {selectedAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="text-sm flex items-center justify-between gap-3 rounded-md bg-[#f5f8fc] p-3"
                  >
                    <span className="break-all">{asset.name}</span>
                    <button
                      className={buttonClass}
                      onClick={() => setForm((previous) => removeArtifactAsset(previous, asset.id))}
                    >
                      移除材料
                    </button>
                  </div>
                ))}
              </div>
              <div className="text-sm block">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={!artifact}
                  onClick={() => uploadInput.current?.click()}
                >
                  上传文件
                </button>
                <input
                  ref={uploadInput}
                  aria-label="上传成果文件"
                  type="file"
                  disabled={!artifact}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file && artifact)
                      void run(async () => {
                        addAsset(await artifactService.upload(slug, artifact.id, file));
                        setMessage("文件已上传并选入材料，请保存草稿。");
                      });
                  }}
                />
              </div>
              {!artifact && (
                <p className="text-sm text-[#718399]">首次保存草稿后即可上传文件；现在可先选择工作项材料或添加链接。</p>
              )}
            </Section>
            <Section title="应用与演示链接">
              {form.links.map((link, index) => (
                <div
                  // oxlint-disable-next-line react/no-array-index-key
                  key={index}
                  className="grid items-end gap-3 rounded-md bg-[#f5f8fc] p-3 md:grid-cols-[1fr_2fr_130px_auto]"
                >
                  <Field label="链接标题">
                    <input
                      className={inputClass}
                      value={link.title}
                      onChange={(e) =>
                        change(
                          "links",
                          form.links.map((item, i) => (i === index ? { ...item, title: e.target.value } : item))
                        )
                      }
                    />
                  </Field>
                  <Field label="链接地址">
                    <input
                      className={inputClass}
                      type="url"
                      placeholder="https://"
                      value={link.url}
                      onChange={(e) => {
                        const url = e.target.value;
                        change(
                          "links",
                          form.links.map((item, i) => (i === index ? { ...item, url } : item))
                        );
                        if (form.primary_action.type === "link" && form.primary_action.url === link.url)
                          change("primary_action", { ...form.primary_action, url });
                      }}
                    />
                  </Field>
                  <Field label="用途">
                    <select
                      className={inputClass}
                      value={link.kind}
                      onChange={(e) =>
                        change(
                          "links",
                          form.links.map((item, i) =>
                            i === index
                              ? { ...item, kind: e.target.value as "application" | "demo" | "reference" }
                              : item
                          )
                        )
                      }
                    >
                      <option value="application">应用入口</option>
                      <option value="demo">演示</option>
                      <option value="reference">参考资料</option>
                    </select>
                  </Field>
                  <button
                    className={buttonClass}
                    onClick={() => {
                      change(
                        "links",
                        form.links.filter((_, i) => i !== index)
                      );
                      if (form.primary_action.type === "link" && form.primary_action.url === link.url)
                        change("primary_action", { type: "detail", label: "查看详情" });
                    }}
                  >
                    移除
                  </button>
                </div>
              ))}
              <button
                className={buttonClass}
                onClick={() => change("links", [...form.links, { title: "", url: "", kind: "application" }])}
              >
                添加链接
              </button>
            </Section>
            <Section title="展示与主操作">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="封面">
                  <select
                    className={inputClass}
                    value={form.cover_asset_id ?? ""}
                    onChange={(e) => change("cover_asset_id", e.target.value || null)}
                  >
                    <option value="">无封面</option>
                    {selectedAssets
                      .filter((asset) => asset.type.startsWith("image/") || asset.id === form.cover_asset_id)
                      .map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="主操作目标">
                  <select
                    className={inputClass}
                    value={
                      form.primary_action.type === "detail"
                        ? "detail"
                        : form.primary_action.type === "attachment"
                          ? `asset:${form.primary_action.attachment_id}`
                          : `link:${form.primary_action.url}`
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      const label = form.primary_action.label;
                      change(
                        "primary_action",
                        value === "detail"
                          ? { type: "detail", label }
                          : value.startsWith("asset:")
                            ? { type: "attachment", label, attachment_id: value.slice(6) }
                            : { type: "link", label, url: value.slice(5) }
                      );
                    }}
                  >
                    <option value="detail">成果详情</option>
                    {selectedAssets.map((asset) => (
                      <option key={asset.id} value={`asset:${asset.id}`}>
                        材料：{asset.name}
                      </option>
                    ))}
                    {form.links
                      .filter((link) => isSafeHttpUrl(link.url))
                      .map((link) => (
                        <option key={link.url} value={`link:${link.url}`}>
                          链接：{link.title}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="主操作按钮文字">
                  <input
                    className={inputClass}
                    value={form.primary_action.label}
                    onChange={(e) => change("primary_action", { ...form.primary_action, label: e.target.value })}
                  />
                </Field>
              </div>
            </Section>
          </fieldset>
          <div className="shadow-sm sticky bottom-0 z-10 mt-6 flex flex-wrap gap-3 rounded-xl border border-[#dce5ef] bg-white/95 p-4">
            <button disabled={busy || conflict} className={buttonClass} onClick={() => void saveAction("save")}>
              {busy ? "正在处理…" : "保存草稿"}
            </button>
            <button disabled={busy || conflict} className={buttonClass} onClick={() => void saveAction("preview")}>
              预览草稿
            </button>
            <button disabled={busy || conflict} className={primaryClass} onClick={() => void saveAction("publish")}>
              发布
            </button>
            <p className="text-xs self-center text-[#718399]">预览和发布会先保存当前修改。</p>
          </div>
          {artifact && (
            <div className="mt-6 space-y-5">
              <Section title="修订历史">
                <p className="text-sm text-[#718399]">恢复仅更新草稿，需再次发布才会改变展厅。</p>
                {revisions.map((revision) => (
                  <div
                    key={revision.id}
                    className="text-sm flex flex-wrap items-center justify-between gap-3 border-b border-[#e6edf4] py-3"
                  >
                    <span>
                      版本 {revision.version} · {new Date(revision.created_at).toLocaleString("zh-CN")} ·{" "}
                      {revision.actor_name}
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={busy}
                        className={buttonClass}
                        onClick={() =>
                          void run(async () =>
                            setRevisionView((await artifactService.revision(slug, artifact.id, revision.id)).snapshot)
                          )
                        }
                      >
                        查看
                      </button>
                      <button
                        disabled={busy || conflict}
                        className={buttonClass}
                        onClick={() => {
                          if (
                            window.confirm(
                              `将「${artifact.title}」恢复为版本 ${revision.version} 的草稿？当前未保存修改将被替换，恢复后仍需发布。`
                            )
                          )
                            void run(async () => {
                              apply(await artifactService.restore(slug, artifact.id, revision.id, artifact.version));
                              setMessage("修订已恢复为草稿，请检查后再次发布。");
                            });
                        }}
                      >
                        恢复为草稿
                      </button>
                    </div>
                  </div>
                ))}
                {!revisions.length && <p className="text-sm text-[#718399]">发布成果后会生成修订。</p>}
                {revisionView && (
                  <div className="text-sm rounded-md bg-[#f5f8fc] p-4">
                    <h3 className="font-semibold">{revisionView.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap">{revisionView.summary}</p>
                    <p className="mt-2">类型：{revisionView.kind}</p>
                    <p>分类：{revisionView.category || "未分类"}</p>
                    <p>主操作：{revisionView.primary_action.label}</p>
                    <ul className="mt-2 list-inside list-disc">
                      {revisionView.assets.map((asset) => (
                        <li key={asset.id}>{asset.name}</li>
                      ))}
                    </ul>
                    <ul className="mt-2 list-inside list-disc">
                      {revisionView.sources.map((source) => (
                        <li key={source.id}>
                          {source.identifier} · {source.name}
                        </li>
                      ))}
                    </ul>
                    {revisionView.links.map((link) => (
                      <p key={link.url}>
                        {link.title} · {link.url}
                      </p>
                    ))}
                    <p className="mt-2">
                      材料 {revisionView.assets.length} 项 · 关联工作项 {revisionView.source_issue_ids.length} 项
                    </p>
                    <button className={`${buttonClass} mt-3`} onClick={() => setRevisionView(undefined)}>
                      关闭修订内容
                    </button>
                  </div>
                )}
              </Section>
              <Section title="更多操作">
                <div className="flex flex-wrap gap-3">
                  {artifact.status === "published" && (
                    <button
                      disabled={busy || conflict}
                      className={buttonClass}
                      onClick={() => {
                        if (window.confirm(`撤下「${artifact.title}」？展厅将不再展示此成果，草稿与修订仍保留。`))
                          void run(async () => {
                            const withdrawn = await artifactService.withdraw(slug, artifact.id, artifact.version);
                            setArtifact((previous) => (previous ? { ...previous, ...withdrawn } : previous));
                            setForm((previous) => ({ ...previous, version: withdrawn.version }));
                            setBaseline((previous) => ({ ...previous, version: withdrawn.version }));
                            setMessage("成果已撤下，本地未保存修改已保留，可保存草稿后重新发布。");
                          });
                      }}
                    >
                      撤下成果
                    </button>
                  )}
                  <button
                    disabled={busy || conflict}
                    className={`${buttonClass} text-red-700`}
                    onClick={() => {
                      if (window.confirm(`删除「${artifact.title}」？成果将不再可见，关联工作项和共享文件会保留。`))
                        void run(async () => {
                          await artifactService.remove(slug, artifact.id, artifact.version);
                          router.push(`/${slug}/gallery/manage/`);
                        });
                    }}
                  >
                    删除成果
                  </button>
                </div>
              </Section>
            </div>
          )}
        </>
      )}
    </ArtifactShell>
  );
}
