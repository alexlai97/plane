import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type { Presentation, PresentationListResponse, PresentationDocument } from "../helpers/presentation";

export class PresentationService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(workspaceSlug: string): Promise<PresentationListResponse> {
    const { data } = await this.get(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/presentations/`);
    return data as PresentationListResponse;
  }

  async getPresentation(workspaceSlug: string, id: string, draft = false): Promise<Presentation> {
    const { data } = await this.get(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/presentations/${encodeURIComponent(id)}/`,
      {
        params: draft ? { view: "draft" } : {},
      }
    );
    return data;
  }

  async create(workspaceSlug: string, values: { title: string; project_id: string; document: PresentationDocument }) {
    const { data } = await this.post(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/presentations/`, values);
    return data as Presentation;
  }

  async save(
    workspaceSlug: string,
    id: string,
    values: { version: number; title: string; document: PresentationDocument }
  ) {
    const { data } = await this.patch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/presentations/${encodeURIComponent(id)}/`,
      values
    );
    return data as Presentation;
  }

  async publish(workspaceSlug: string, id: string, version: number) {
    const { data } = await this.post(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/presentations/${encodeURIComponent(id)}/publish/`,
      { version }
    );
    return data as Presentation;
  }
}

export const presentationService = new PresentationService();
