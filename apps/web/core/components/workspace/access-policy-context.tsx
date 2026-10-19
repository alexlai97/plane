import { createContext, useContext } from "react";
import type { WorkspaceAccessPolicy } from "@/services/access-policy.service";

export type WorkspaceAccessPolicyState = {
  policy?: WorkspaceAccessPolicy;
  loading: boolean;
  error?: unknown;
};

export const WorkspaceAccessPolicyContext = createContext<WorkspaceAccessPolicyState>({ loading: true });

export function useWorkspaceAccessPolicy() {
  return useContext(WorkspaceAccessPolicyContext);
}
