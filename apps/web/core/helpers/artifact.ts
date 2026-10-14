import type { GalleryCard, GalleryAction, GalleryLink, GallerySource } from "./gallery";

export type ArtifactAsset = { id: string; name: string; size: number; type: string };
export type Artifact = GalleryCard & {
  category_id: string | null;
  source_issue_ids: string[];
  assets: ArtifactAsset[];
  owner_id: string;
  status: "draft" | "published" | "withdrawn";
  version: number;
  published_version: number | null;
  has_unpublished_changes: boolean;
  can_edit: boolean;
  unavailable_reference_count: number;
  cover: (NonNullable<GalleryCard["cover"]> & { asset_id: string }) | null;
};
export type ArtifactCategory = { id: string; name: string; usage_count: number; version: number };
export type ArtifactSource = { id: string; identifier: string; name: string; project_id: string };
export type ArtifactRevision = { id: string; version: number; actor_name: string; created_at: string };
export type ArtifactWrite = {
  title: string;
  summary: string;
  kind: string;
  category_id: string | null;
  source_issue_ids: string[];
  assets: { id: string }[];
  links: Pick<GalleryLink, "title" | "url" | "kind">[];
  cover_asset_id: string | null;
  primary_action: GalleryAction;
  version?: number;
};
export type ArtifactSnapshot = Omit<ArtifactWrite, "assets"> & {
  assets: ArtifactAsset[];
  sources: GallerySource[];
  category: string;
};
export const artifactStatus = { draft: "草稿", published: "已发布", withdrawn: "已撤下" };
export function getArtifactShareUrl(value: string, view: "draft" | "published"): string {
  const url = new URL(value, "https://artifact.local");
  url.searchParams.delete("from");
  if (view === "draft") url.searchParams.set("view", "draft");
  else url.searchParams.delete("view");
  return value.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

export function artifactToWrite(artifact?: Artifact): ArtifactWrite {
  return {
    title: artifact?.title ?? "",
    summary: artifact?.summary ?? "",
    kind: artifact?.kind ?? "",
    category_id: artifact?.category_id ?? null,
    source_issue_ids: artifact?.source_issue_ids ?? [],
    assets: artifact?.assets.map(({ id }) => ({ id })) ?? [],
    links: artifact?.links.map(({ title, url, kind }) => ({ title, url, kind })) ?? [],
    cover_asset_id: artifact?.cover?.asset_id ?? null,
    primary_action: artifact?.primary_action ?? { type: "detail", label: "查看详情" },
    ...(artifact ? { version: artifact.version } : {}),
  };
}
export function removeArtifactAsset(form: ArtifactWrite, id: string): ArtifactWrite {
  return {
    ...form,
    assets: form.assets.filter((asset) => asset.id !== id),
    cover_asset_id: form.cover_asset_id === id ? null : form.cover_asset_id,
    primary_action:
      form.primary_action.type === "attachment" && form.primary_action.attachment_id === id
        ? { type: "detail", label: "查看详情" }
        : form.primary_action,
  };
}
export function artifactError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response;
  if (response?.status === 409)
    return "内容已被其他成员修改或当前操作无法完成。本地输入已保留，请查看最新内容后合并再保存。";
  if (response?.status === 403 || response?.status === 404) return "没有访问权限，或该成果已不存在。";
  const data = response?.data;
  if (data && typeof data === "object") {
    const messages = Object.values(data)
      .flat()
      .filter((value): value is string => typeof value === "string");
    if (messages.length) return messages.join("；");
  }
  if (error instanceof Error && !response && !error.message.includes("Network")) return error.message;
  return "操作失败，请检查连接后重试。";
}

export const artifactWriteFields = [
  "title",
  "summary",
  "kind",
  "category_id",
  "source_issue_ids",
  "assets",
  "links",
  "cover_asset_id",
  "primary_action",
] as const;
export type ArtifactWriteField = (typeof artifactWriteFields)[number];
export type ArtifactMergeChoices = Partial<Record<ArtifactWriteField, "local" | "latest">>;
export const artifactFieldLabels: Record<ArtifactWriteField, string> = {
  title: "成果名称",
  summary: "简短说明",
  kind: "类型",
  category_id: "分类",
  source_issue_ids: "关联工作项",
  assets: "成果材料",
  links: "链接（标题、地址与用途）",
  cover_asset_id: "封面",
  primary_action: "主操作（目标与按钮文字）",
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        // oxlint-disable-next-line unicorn/no-array-sort -- Object.entries creates a fresh array; web targets pre-ES2023 libraries.
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}
function equalWriteValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
/** Arrays are resolved as one field. Unresolved concurrent edits never silently select a side. */
export function mergeArtifactWrites(
  baseline: ArtifactWrite,
  local: ArtifactWrite,
  latest: ArtifactWrite,
  choices: ArtifactMergeChoices = {}
): { merged: ArtifactWrite; conflicts: ArtifactWriteField[]; unresolved: ArtifactWriteField[] } {
  const merged = { ...local, version: latest.version };
  const conflicts: ArtifactWriteField[] = [];
  const unresolved: ArtifactWriteField[] = [];
  for (const field of artifactWriteFields) {
    const localChanged = !equalWriteValue(local[field], baseline[field]);
    const latestChanged = !equalWriteValue(latest[field], baseline[field]);
    if (localChanged && latestChanged && !equalWriteValue(local[field], latest[field])) {
      conflicts.push(field);
      if (!choices[field]) unresolved.push(field);
      Object.assign(merged, { [field]: choices[field] === "latest" ? latest[field] : local[field] });
    } else Object.assign(merged, { [field]: localChanged ? local[field] : latest[field] });
  }
  return { merged, conflicts, unresolved };
}
