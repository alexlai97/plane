/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

const LazyArtifactDetail = lazy(async () => {
  const module = await import("@/components/artifacts/detail");
  return { default: module.ArtifactDetail };
});

type ArtifactPeek = { id: string; workspaceSlug: string; returnHref: string; trigger: HTMLElement };
type ArtifactPeekContextValue = { openArtifact: (id: string, returnHref: string, trigger: HTMLElement) => void };

const ArtifactPeekContext = createContext<ArtifactPeekContextValue | null>(null);

export function getArtifactPeekFocusTarget(trigger: HTMLElement | undefined, fallback: HTMLElement | null) {
  return trigger?.isConnected ? trigger : (fallback ?? undefined);
}

export function useArtifactPeek() {
  const context = useContext(ArtifactPeekContext);
  if (!context) throw new Error("useArtifactPeek must be used inside ArtifactFavoritePeekProvider");
  return context;
}

export function ArtifactFavoritePeekProvider({
  workspaceSlug,
  children,
}: {
  workspaceSlug: string;
  children: ReactNode;
}) {
  const [peek, setPeek] = useState<ArtifactPeek>();
  const previousWorkspace = useRef(workspaceSlug);
  const openArtifact = useCallback(
    (id: string, returnHref: string, trigger: HTMLElement) => setPeek({ id, returnHref, workspaceSlug, trigger }),
    [workspaceSlug]
  );
  const closeArtifact = useCallback(() => {
    const trigger = peek?.trigger;
    setPeek(undefined);
    requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLElement>('[data-testid="sidebar-favorites-toggle"]');
      getArtifactPeekFocusTarget(trigger, fallback)?.focus({ preventScroll: true });
    });
  }, [peek]);

  useEffect(() => {
    if (previousWorkspace.current !== workspaceSlug) {
      previousWorkspace.current = workspaceSlug;
      setPeek(undefined);
    }
  }, [workspaceSlug]);

  const contextValue = useMemo(() => ({ openArtifact }), [openArtifact]);
  return (
    <ArtifactPeekContext.Provider value={contextValue}>
      {children}
      <div data-testid="artifact-favorite-peek-host" data-workspace-slug={workspaceSlug}>
        {peek?.workspaceSlug === workspaceSlug && (
          <Suspense fallback={null}>
            <LazyArtifactDetail
              key={`${peek.workspaceSlug}:${peek.id}`}
              slug={peek.workspaceSlug}
              id={peek.id}
              returnHref={peek.returnHref}
              onClose={closeArtifact}
            />
          </Suspense>
        )}
      </div>
    </ArtifactPeekContext.Provider>
  );
}
