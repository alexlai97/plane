import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import { cacheWorkspaceAccessPolicy, clearWorkspaceAccessPolicy } from "@/helpers/workspace-access-policy";

export type WorkspaceAccessPolicy = {
  profile: string;
  capabilities: string[];
  project_ids: string[] | null;
  view_ids: string[] | null;
};

class AccessPolicyService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getWorkspacePolicy(workspaceSlug: string): Promise<WorkspaceAccessPolicy> {
    clearWorkspaceAccessPolicy(workspaceSlug);
    const response = await this.get(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/access-policy/`);
    const policy = response.data as WorkspaceAccessPolicy;
    cacheWorkspaceAccessPolicy(workspaceSlug, policy);
    return policy;
  }
}

export const accessPolicyService = new AccessPolicyService();
