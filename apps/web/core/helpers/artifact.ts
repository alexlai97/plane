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
