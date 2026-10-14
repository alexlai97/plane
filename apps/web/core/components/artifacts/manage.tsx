import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { artifactService } from "@/services/artifact.service";
import { artifactError, artifactStatus } from "../../helpers/artifact";
import type { Artifact, ArtifactCategory } from "../../helpers/artifact";
import { ArtifactShell, buttonClass, ConfirmDialog, inputClass, Message, primaryClass, Section } from "./shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@plane/propel/table";

export default function ArtifactManagePage() {
  const slug = useParams().workspaceSlug?.toString() ?? "";
  const [rows, setRows] = useState<Artifact[]>([]);
  const [categories, setCategories] = useState<ArtifactCategory[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [canManageCategories, setCanManageCategories] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showCategories, setShowCategories] = useState(false);
  const [newName, setNewName] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmCategory, setConfirmCategory] = useState<ArtifactCategory>();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cats] = await Promise.all([artifactService.list(slug, "manage"), artifactService.categories(slug)]);
      setRows(list.results);
      setCanCreate(list.can_create);
      setCategories(cats.results);
      setCanManageCategories(cats.can_manage);
      setNames(Object.fromEntries(cats.results.map((item) => [item.id, item.name])));
    } catch (e) {
      setError(artifactError(e));
    } finally {
      setLoading(false);
    }
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load]);
  const categoryAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setNewName("");
      await load();
    } catch (e) {
      setError(artifactError(e));
    } finally {
      setBusy(false);
    }
  };
  const visible = rows.filter(
    (row) =>
      (!categoryId || row.category_id === categoryId) &&
      `${row.title} ${row.summary}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  return (
    <ArtifactShell
      slug={slug}
      title="管理成果"
      actions={
        <>
          {canManageCategories && (
            <button type="button" className={buttonClass} onClick={() => setShowCategories(!showCategories)}>
              分类管理
            </button>
          )}
          {canCreate && (
            <a className={primaryClass} href={`/${slug}/gallery/new/`}>
              新建成果
            </a>
          )}
        </>
      }
    >
      <Message error={error} />
      {showCategories && (
        <div className="mb-6">
          <Section title="分类管理">
            {categories.map((cat) => (
              <div key={cat.id} className="flex flex-wrap items-center gap-3">
                <input
                  aria-label={`分类名称：${cat.name}`}
                  className={`${inputClass} max-w-xs`}
                  value={names[cat.id] ?? cat.name}
                  onChange={(e) => setNames({ ...names, [cat.id]: e.target.value })}
                />
                <span className="text-xs text-tertiary">{cat.usage_count} 项成果或修订使用</span>
                <button
                  type="button"
                  disabled={busy || !names[cat.id]?.trim()}
                  className={buttonClass}
                  onClick={() => void categoryAction(() => artifactService.saveCategory(slug, names[cat.id], cat))}
                >
                  保存名称
                </button>
                <button
                  type="button"
                  disabled={busy || cat.usage_count > 0}
                  title={cat.usage_count ? "仍被成果或修订使用，不能删除" : undefined}
                  className={buttonClass}
                  onClick={() => {
                    setConfirmCategory(cat);
                  }}
                >
                  删除
                </button>
              </div>
            ))}
            <div className="flex gap-3">
              <input
                aria-label="新分类名称"
                placeholder="新分类名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className={`${inputClass} max-w-xs`}
              />
              <button
                type="button"
                disabled={busy || !newName.trim()}
                className={buttonClass}
                onClick={() => void categoryAction(() => artifactService.saveCategory(slug, newName))}
              >
                新增分类
              </button>
            </div>
          </Section>
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-3">
        <input
          aria-label="搜索成果"
          placeholder="搜索成果名称或说明"
          className={`${inputClass} max-w-md`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="筛选分类"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={`${inputClass} max-w-xs`}
        >
          <option value="">全部分类</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p role="status">正在加载成果…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-subtle bg-surface-1">
          <Table>
            <TableHeader>
              <TableRow>
                {["成果", "分类", "状态", "更新日期", "操作"].map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.title}</TableCell>
                  <TableCell>{row.category || "未分类"}</TableCell>
                  <TableCell>
                    {artifactStatus[row.status]}
                    {row.has_unpublished_changes && (
                      <span className="text-xs mt-1 block text-warning-primary">有未发布修改</span>
                    )}
                  </TableCell>
                  <TableCell>{new Date(row.updated_at).toLocaleDateString("zh-CN")}</TableCell>
                  <TableCell>
                    <div className="flex gap-4">
                      {row.can_edit && (
                        <a href={`/${slug}/gallery/${row.id}/edit/`} className="text-link-primary underline">
                          编辑
                        </a>
                      )}
                      <a
                        href={`/${slug}/gallery/${row.id}/${row.can_edit ? "?view=draft" : ""}`}
                        className="text-link-primary underline"
                      >
                        {row.can_edit ? "预览草稿" : "查看成果"}
                      </a>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!visible.length && (
            <p className="p-10 text-center text-tertiary">
              {search ? "没有匹配的成果，试试其他关键词。" : "暂无成果，可通过新建成果开始整理。"}
            </p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirmCategory)}
        title={`删除分类「${confirmCategory?.name ?? ""}」？`}
        description="确认后会删除这个工作区类别。该类别不会影响成果材料。"
        confirmLabel="删除分类"
        onCancel={() => setConfirmCategory(undefined)}
        onConfirm={async () => {
          if (!confirmCategory) return;
          await artifactService.removeCategory(slug, confirmCategory);
          setConfirmCategory(undefined);
          await load();
        }}
      />
    </ArtifactShell>
  );
}
