import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type WorkItemTemplate = {
  id: string;
  key: string;
  name: string;
  description_html: string;
  recommended_member_ids: string[];
  is_default: boolean;
  version: number;
};
export class WorkItemTemplateService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  url(slug: string, project: string, id?: string) {
    return `/api/workspaces/${slug}/projects/${project}/work-item-templates/${id ? `${id}/` : ""}`;
  }
  async list(slug: string, project: string): Promise<{ results: WorkItemTemplate[]; can_manage: boolean }> {
    return (await this.get(this.url(slug, project))).data;
  }
  async save(slug: string, project: string, data: Partial<WorkItemTemplate>): Promise<WorkItemTemplate> {
    return (
      data.id
        ? await this.patch(this.url(slug, project, data.id), data)
        : await this.post(this.url(slug, project), data)
    ).data;
  }
  async remove(slug: string, project: string, id: string) {
    await this.delete(this.url(slug, project, id));
  }
}
