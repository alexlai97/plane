import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type {
  Artifact,
  ArtifactAsset,
  ArtifactCategory,
  ArtifactRevision,
  ArtifactSource,
  ArtifactSnapshot,
  ArtifactWrite,
} from "../helpers/artifact";

class ArtifactService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  private base(slug: string) {
    return `/api/workspaces/${encodeURIComponent(slug)}`;
  }
  async list(
    slug: string,
    scope: "published" | "manage" = "published",
    search = ""
  ): Promise<{ results: Artifact[]; count: number; can_create: boolean }> {
    return (await this.get(`${this.base(slug)}/artifacts/`, { params: { scope, search } })).data;
  }
  async detail(slug: string, id: string, view: "draft" | "published" = "published"): Promise<Artifact> {
    return (await this.get(`${this.base(slug)}/artifacts/${id}/`, { params: { view } })).data;
  }
  async save(slug: string, data: ArtifactWrite, id?: string): Promise<Artifact> {
    const url = `${this.base(slug)}/artifacts/${id ? `${id}/` : ""}`;
    return (await (id ? this.patch(url, data) : this.post(url, data))).data;
  }
  async publish(slug: string, id: string, version: number): Promise<Artifact> {
    return (await this.post(`${this.base(slug)}/artifacts/${id}/publish/`, { version })).data;
  }
  async withdraw(slug: string, id: string, version: number): Promise<void> {
    await this.post(`${this.base(slug)}/artifacts/${id}/withdraw/`, { version });
  }
  async remove(slug: string, id: string, version: number): Promise<void> {
    await this.delete(`${this.base(slug)}/artifacts/${id}/`, { version });
  }
  async categories(slug: string): Promise<{ results: ArtifactCategory[]; can_manage: boolean }> {
    return (await this.get(`${this.base(slug)}/artifact-categories/`)).data;
  }
  async saveCategory(slug: string, name: string, category?: ArtifactCategory): Promise<void> {
    const url = `${this.base(slug)}/artifact-categories/${category ? `${category.id}/` : ""}`;
    await (category ? this.patch(url, { name, version: category.version }) : this.post(url, { name }));
  }
  async removeCategory(slug: string, category: ArtifactCategory): Promise<void> {
    await this.delete(`${this.base(slug)}/artifact-categories/${category.id}/`, { version: category.version });
  }
  async sources(slug: string, search: string): Promise<ArtifactSource[]> {
    return (await this.get(`${this.base(slug)}/artifact-sources/`, { params: { search } })).data.results;
  }
  async materials(slug: string, id: string): Promise<ArtifactAsset[]> {
    return (await this.get(`${this.base(slug)}/artifact-sources/${id}/materials/`)).data.results;
  }
  async upload(slug: string, id: string, file: File): Promise<ArtifactAsset> {
    const body = new FormData();
    body.append("file", file);
    return (await this.post(`${this.base(slug)}/artifacts/${id}/uploads/`, body)).data;
  }
  async revisions(slug: string, id: string): Promise<ArtifactRevision[]> {
    return (await this.get(`${this.base(slug)}/artifacts/${id}/revisions/`)).data.results;
  }
  async revision(slug: string, id: string, revisionId: string): Promise<{ snapshot: ArtifactSnapshot }> {
    return (await this.get(`${this.base(slug)}/artifacts/${id}/revisions/${revisionId}/`)).data;
  }
  async restore(slug: string, id: string, revisionId: string, version: number): Promise<Artifact> {
    return (await this.post(`${this.base(slug)}/artifacts/${id}/revisions/${revisionId}/restore/`, { version })).data;
  }
}
export const artifactService = new ArtifactService();
