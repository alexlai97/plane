import { ArtifactAssignees } from "./assignees";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { AppWindow, AudioLines, ChevronRight, FileText, FolderOpen, Image, Layers, Video } from "lucide-react";
import { Handle, Position, ReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { Card, ECardSpacing, ECardVariant } from "@plane/propel/card";
import type { GalleryCard, GalleryLayout, GalleryOverviewGroup, GalleryTreeNode } from "../../helpers/gallery";
import { getGalleryResultIcon, layoutGalleryTree } from "../../helpers/gallery";
// oxlint-disable-next-line import/no-unassigned-import -- React Flow requires its canvas and edge stylesheet.
import "@xyflow/react/dist/style.css";

const resultIcons = { application: AppWindow, video: Video, audio: AudioLines, image: Image, document: FileText };
export type GalleryDetailLinkHandler = (event: MouseEvent<HTMLAnchorElement>, card: GalleryCard) => void;
type OnOpenDetail = GalleryDetailLinkHandler;
function ResultLink({ card, href, onOpenDetail }: { card: GalleryCard; href: string; onOpenDetail: OnOpenDetail }) {
  const Icon = resultIcons[getGalleryResultIcon(card)];
  return (
    <a
      href={href}
      onClick={(event) => onOpenDetail(event, card)}
      className="nodrag nopan group focus-visible:ring-accent-primary flex size-full min-h-8 items-center gap-3 rounded-md px-3 py-1.5 text-14 font-medium text-primary transition-colors outline-none hover:bg-accent-subtle hover:text-link-primary focus-visible:ring-2"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-accent-primary" />
      <span className="min-w-0 flex-1 break-words">{card.title}</span>
      <ArtifactAssignees ids={card.assignee_ids} />
      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-tertiary group-hover:text-link-primary" />
    </a>
  );
}

type OverviewNodeData = Record<string, unknown> & { item: GalleryTreeNode; href?: string; onOpenDetail: OnOpenDetail };
type OverviewNode = Node<OverviewNodeData, "overview">;
function OverviewTreeNode({ data }: NodeProps<OverviewNode>) {
  const { item } = data;
  return (
    <>
      {item.kind !== "root" && (
        <Handle type="target" position={Position.Left} className="invisible" isConnectable={false} />
      )}
      {item.kind === "result" && item.card ? (
        <ResultLink card={item.card} href={data.href!} onOpenDetail={data.onOpenDetail} />
      ) : (
        <div
          className={`flex size-full items-center gap-2 rounded-md border border-subtle bg-surface-2 px-3 text-14 font-semibold text-primary ${item.kind === "root" ? "flex-col justify-center" : ""}`}
        >
          {item.kind === "root" ? (
            <Layers aria-hidden="true" className="size-5 shrink-0 text-accent-primary" />
          ) : (
            <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-accent-primary" />
          )}
          <span className="min-w-0 break-words">{item.title}</span>
          <span className="font-normal text-12 text-secondary">
            {item.count}
            {item.kind === "root" ? " 项" : ""}
          </span>
        </div>
      )}
      {item.kind !== "result" && (
        <Handle type="source" position={Position.Right} className="invisible" isConnectable={false} />
      )}
    </>
  );
}
const nodeTypes = { overview: OverviewTreeNode };

function SectionOverview({
  groups,
  detailHref,
  onOpenDetail,
}: {
  groups: GalleryOverviewGroup[];
  detailHref: (card: GalleryCard) => string;
  onOpenDetail: OnOpenDetail;
}) {
  return (
    <div aria-label="分区成果总览" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => (
        <Card key={group.id} variant={ECardVariant.WITHOUT_SHADOW} spacing={ECardSpacing.SM}>
          <section aria-label={group.name}>
            <h2 className="mb-3 flex items-center gap-2 border-b border-subtle pb-3 text-16 font-semibold text-primary">
              <FolderOpen aria-hidden="true" className="size-5 text-accent-primary" />
              {group.name}
              <span className="font-normal ml-auto text-12 text-tertiary">{group.cards.length} 项</span>
            </h2>
            <ul className="space-y-1">
              {group.cards.map((card) => (
                <li key={card.id}>
                  <ResultLink card={card} href={detailHref(card)} onOpenDetail={onOpenDetail} />
                </li>
              ))}
            </ul>
          </section>
        </Card>
      ))}
    </div>
  );
}

export function GalleryOverview({
  groups,
  layout,
  detailHref,
  onOpenDetail,
}: {
  groups: GalleryOverviewGroup[];
  layout: GalleryLayout;
  detailHref: (card: GalleryCard) => string;
  onOpenDetail: OnOpenDetail;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const graph = useMemo(() => layoutGalleryTree(groups, Math.max(640, width)), [groups, width]);
  const nodes: OverviewNode[] = graph.nodes.map((item) => ({
    id: item.id,
    type: "overview",
    position: { x: item.x, y: item.y },
    width: item.width,
    height: item.height,
    style: { width: item.width, height: item.height, pointerEvents: item.kind === "result" ? "all" : "none" },
    data: { item, href: item.card ? detailHref(item.card) : undefined, onOpenDetail },
  }));
  const edges = graph.edges.map((edge) => ({
    ...edge,
    type: "smoothstep",
    style: { stroke: "var(--border-strong)", strokeWidth: 1 },
    focusable: false,
  }));
  return (
    <div ref={containerRef}>
      {layout === "sections" || (width > 0 && width < 640) ? (
        <SectionOverview groups={groups} detailHref={detailHref} onOpenDetail={onOpenDetail} />
      ) : width > 0 ? (
        <div aria-label="树状成果总览" style={{ height: graph.height }}>
          <ReactFlow<OverviewNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            minZoom={1}
            maxZoom={1}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag={false}
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            style={{ background: "transparent" }}
          />
        </div>
      ) : (
        <p role="status" className="text-13 text-secondary">
          正在排列成果…
        </p>
      )}
    </div>
  );
}
