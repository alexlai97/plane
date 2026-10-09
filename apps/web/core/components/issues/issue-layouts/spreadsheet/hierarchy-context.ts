import { createContext, useContext } from "react";

export const SpreadsheetHierarchyContext = createContext({
  expanded: false,
  revision: 0,
  rootIds: new Set<string>(),
});
export const useSpreadsheetHierarchy = () => useContext(SpreadsheetHierarchyContext);
