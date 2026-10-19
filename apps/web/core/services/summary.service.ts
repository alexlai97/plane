import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type SummaryView = {
  id: string;
  project_id: string | null;
  project_identifier?: string | null;
  project_name?: string | null;
  name: string;
  display_filters?: unknown;
  filters?: unknown;
  rich_filters?: unknown;
};

export type SummaryWorkItem = {
  id: string;
  project_id: string;
  identifier: string;
  name: string;
  state?: { id: string; name: string; group?: string; color?: string } | null;
  assignees?: Array<{ id: string; name: string; avatar_url?: string | null }>;
  priority?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  parent_id?: string | null;
  context_only?: boolean;
  children?: SummaryWorkItem[];
};

export type SummaryViewItems = {
  results: SummaryWorkItem[];
  view: { id: string; name: string; project_id: string | null };
  count: number;
};

class SummaryService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getViews(workspaceSlug: string): Promise<SummaryView[]> {
    const response = await this.get(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/summary/views/`);
    return (response.data?.results ?? []) as SummaryView[];
  }

  async getViewItems(workspaceSlug: string, viewId: string, projectId?: string): Promise<SummaryViewItems> {
    const endpoint = projectId
      ? `/api/workspaces/${encodeURIComponent(workspaceSlug)}/summary/projects/${encodeURIComponent(projectId)}/views/${encodeURIComponent(viewId)}/work-items/`
      : `/api/workspaces/${encodeURIComponent(workspaceSlug)}/summary/views/${encodeURIComponent(viewId)}/work-items/`;
    const response = await this.get(endpoint);
    return response.data as SummaryViewItems;
  }
}

export const summaryService = new SummaryService();
