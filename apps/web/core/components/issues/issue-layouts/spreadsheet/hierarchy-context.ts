import { createContext, useContext } from "react";

export const SpreadsheetHierarchyContext = createContext({
  expanded: false,
  revision: 0,
  rootIds: new Set<string>(),
  onExpansionChange: (_id: string, _expanded: boolean) => {},
});
export const useSpreadsheetHierarchy = () => useContext(SpreadsheetHierarchyContext);
