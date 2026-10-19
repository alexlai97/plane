"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Pencil,
  Paperclip,
  Plus,
  Save,
  X,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router";
import { observer } from "mobx-react";
import { Button } from "@plane/propel/button";
import { Input } from "@plane/propel/input";
import { TextArea } from "@plane/ui";
import { useProject } from "@/hooks/store/use-project";
import { canReadWorkItemDetails } from "@/helpers/workspace-access-policy";
import { PageHead } from "@/components/core/page-title";
import { AttachmentPreviewModal } from "@/components/issues/attachment/attachment-preview-modal";
import { artifactService } from "@/services/artifact.service";
import type { ArtifactAsset, ArtifactSource } from "../../helpers/artifact";
import {
  buildRevealDocument,
  createPresentationId,
  emptyPresentationDocument,
  presentationSlideIndex,
  presentationKeyboardAction,
} from "../../helpers/presentation";
import type {
  Presentation,
  PresentationDocument,
  PresentationListItem,
  PresentationMedia,
  PresentationSection,
  PresentationSlide,
} from "../../helpers/presentation";
import { presentationService } from "../../services/presentation.service";

const REVEAL_VERSION = "6.0.2";
const button =
  "inline-flex items-center gap-2 rounded-lg border border-subtle-1 bg-surface-1 px-3 py-2 text-13 text-secondary hover:bg-surface-2 disabled:opacity-50";
const input =
  "w-full rounded-md border border-subtle-1 bg-surface-1 px-3 py-2 text-13 text-primary outline-none focus:border-accent-primary";

const makeId = createPresentationId;
const newSlide = (): PresentationSlide => ({
  id: makeId(),
  title: "新页面",
  body: "",
  notes: "",
  issue_ids: [],
  media: [],
  links: [],
});
const newSection = (): PresentationSection => ({ id: makeId(), title: "新章节", slides: [newSlide()] });

const PresentationsPage = observer(function PresentationsPage() {
  const params = useParams();
  const slug = params.workspaceSlug?.toString() ?? "";
  const presentationId = params.presentationId?.toString();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const draftView = searchParams.get("view") === "draft";
  const editRequested = searchParams.get("edit") === "1";
  const { joinedProjectIds, getProjectById } = useProject();
  const createProjectIds = useMemo(
    () => (joinedProjectIds ?? []).filter((id) => Number(getProjectById(id)?.member_role ?? 0) >= 15),
    [getProjectById, joinedProjectIds]
  );
  const [rows, setRows] = useState<PresentationListItem[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [current, setCurrent] = useState<Presentation | null>(null);
  const [title, setTitle] = useState("");
  const [document, setDocument] = useState<PresentationDocument>(emptyPresentationDocument);
  const [selected, setSelected] = useState({ section: 0, slide: -1 });
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<PresentationMedia | null>(null);
  const [newProject, setNewProject] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceResults, setSourceResults] = useState<ArtifactSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<ArtifactSource | null>(null);
  const [sourceMaterials, setSourceMaterials] = useState<ArtifactAsset[]>([]);
  const [materialLoading, setMaterialLoading] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const detailRequest = useRef(0);
  const latestEdits = useRef({ title, document });
  latestEdits.current = { title, document };

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    setCanCreate(false);
    try {
      const response = await presentationService.list(slug);
      const list = response.results;
      setCanCreate(response.can_create);
      setRows(
        [...list].sort(
          (a, b) =>
            Number(Boolean(b.published_revision_id)) - Number(Boolean(a.published_revision_id)) ||
            (b.updated_at ?? "").localeCompare(a.updated_at ?? "")
        )
      );
    } catch {
      setError("汇报列表加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [slug]);
  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    const onSlideChange = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow) return;
      const data = event.data as { type?: string; h?: unknown; v?: unknown; assetId?: unknown };
      if (data.type === "bokang:presentation-media" && typeof data.assetId === "string") {
        const media = document.sections[selected.section]?.slides[selected.slide]?.media.find(
          (item) => item.asset_id === data.assetId && item.can_preview && (item.file_url || item.preview_file_url)
        );
        if (media) {
          if (window.document.fullscreenElement) {
            void window.document.exitFullscreen().then(() => setPreview(media));
          } else setPreview(media);
        }
        return;
      }
      if (data.type === "bokang:presentation-ready") {
        iframe.current?.contentWindow?.postMessage(
          { type: "bokang:presentation-go", h: selected.section, v: Math.max(0, selected.slide) },
          window.location.origin
        );
        return;
      }
      if (data.type !== "bokang:presentation-slide" || !Number.isInteger(data.h) || !Number.isInteger(data.v)) return;
      const section = Number(data.h);
      const vertical = Number(data.v);
      if (
        section < 0 ||
        section >= document.sections.length ||
        vertical < 0 ||
        vertical >= document.sections[section].slides.length
      )
        return;
      setSelected((value) =>
        value.section === section && value.slide === vertical ? value : { section, slide: vertical }
      );
    };
    window.addEventListener("message", onSlideChange);
    return () => window.removeEventListener("message", onSlideChange);
  }, [document.sections, selected.section, selected.slide]);
  useEffect(() => {
    iframe.current?.contentWindow?.postMessage(
      { type: "bokang:presentation-go", h: selected.section, v: Math.max(0, selected.slide) },
      window.location.origin
    );
  }, [selected.section, selected.slide]);

  // The viewer lives in an iframe: keyboard events in the surrounding page do not reach Reveal.
  useEffect(() => {
    if (!current || editing || preview || detailLoading) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))
        return;
      if (
        Array.from(window.document.querySelectorAll('[role="dialog"],[aria-modal="true"]')).some(
          (dialog) => dialog.getClientRects().length > 0,
        )
      )
        return;
      const action = presentationKeyboardAction(event);
      if (!action || !iframe.current?.contentWindow) return;
      // Preserve native activation of focused links and controls.
      if (["Enter", " "].includes(event.key) && target.closest('button,a,[role="button"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      iframe.current.contentWindow.postMessage(
        { type: "bokang:presentation-navigate", action },
        window.location.origin,
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current, editing, preview, detailLoading]);

  const open = useCallback(
    async (id: string, draft = false, edit = false) => {
      const requestId = ++detailRequest.current;
      setDetailLoading(true);
      setError("");
      try {
        const value = await presentationService.getPresentation(slug, id, draft);
        if (requestId !== detailRequest.current) return;
        setCurrent(value);
        setTitle(value.title);
        setDocument(value.document ?? emptyPresentationDocument());
        setSelected({ section: 0, slide: value.document.sections[0]?.slides.length ? 0 : -1 });
        setEditing(edit && value.can_edit);
      } catch {
        if (requestId !== detailRequest.current) return;
        setError("无法打开这份汇报。它可能已被删除，或你没有查看权限。");
        setCurrent(null);
      } finally {
        if (requestId === detailRequest.current) setDetailLoading(false);
      }
    },
    [slug]
  );
  useEffect(() => {
    if (presentationId) void open(presentationId, draftView, editRequested);
    else {
      detailRequest.current += 1;
      setDetailLoading(false);
      setCurrent(null);
      setEditing(false);
    }
  }, [presentationId, draftView, editRequested, open]);

  const setSection = (index: number, update: (section: PresentationSection) => PresentationSection) =>
    setDocument((value) => ({
      ...value,
      sections: value.sections.map((section, i) => (i === index ? update(section) : section)),
    }));
  const setSlide = (
    sectionIndex: number,
    slideIndex: number,
    update: (slide: PresentationSlide) => PresentationSlide
  ) =>
    setSection(sectionIndex, (section) => ({
      ...section,
      slides: section.slides.map((slide, i) => (i === slideIndex ? update(slide) : slide)),
    }));
  const reorderSlide = (sectionIndex: number, slideIndex: number, delta: -1 | 1) => {
    setSection(sectionIndex, (section) => {
      const nextIndex = slideIndex + delta;
      if (nextIndex < 0 || nextIndex >= section.slides.length) return section;
      const slides = [...section.slides];
      [slides[slideIndex], slides[nextIndex]] = [slides[nextIndex], slides[slideIndex]];
      return { ...section, slides };
    });
    setSelected({ section: sectionIndex, slide: slideIndex + delta });
  };
  const reorderSection = (sectionIndex: number, delta: -1 | 1) => {
    const nextIndex = sectionIndex + delta;
    if (nextIndex < 0 || nextIndex >= document.sections.length) return;
    setDocument((value) => {
      const sections = [...value.sections];
      [sections[sectionIndex], sections[nextIndex]] = [sections[nextIndex], sections[sectionIndex]];
      return { ...value, sections };
    });
    setSelected({ section: nextIndex, slide: selected.slide });
  };
  const slide = selected.slide >= 0 ? document.sections[selected.section]?.slides[selected.slide] : undefined;
  const isDirty =
    !!current && (title !== current.title || JSON.stringify(document) !== JSON.stringify(current.document));
  const position = presentationSlideIndex(document, selected.section, selected.slide);

  const save = async () => {
    if (!current) return;
    const submittedTitle = title;
    const submittedDocument = document;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const updated = await presentationService.save(slug, current.id, {
        version: current.version,
        title: submittedTitle.trim(),
        document: submittedDocument,
      });
      setCurrent(updated);
      const hasEditsDuringSave =
        latestEdits.current.title !== submittedTitle ||
        JSON.stringify(latestEdits.current.document) !== JSON.stringify(submittedDocument);
      if (!hasEditsDuringSave) {
        setTitle(updated.title);
        setDocument(updated.document);
        setNotice("更改已保存。");
      } else {
        setNotice("已保存提交时的更改；之后的新编辑仍保留在页面，请再次保存。");
      }
      await loadList();
    } catch (reason: any) {
      const status = reason?.response?.status;
      setError(
        status === 409 || status === 412
          ? "保存冲突：服务器版本已更新。你的编辑仍保留在页面，请复制文本后重新加载并合并。"
          : "保存失败，当前编辑仍保留在页面。请稍后重试。"
      );
    } finally {
      setSaving(false);
    }
  };
  const publish = async () => {
    if (!current) return;
    if (isDirty) {
      setError("请先保存更改，再发布。");
      return;
    }
    const submittedTitle = title;
    const submittedDocument = document;
    setSaving(true);
    setError("");
    try {
      const updated = await presentationService.publish(slug, current.id, current.version);
      setCurrent(updated);
      const hasEditsDuringPublish =
        latestEdits.current.title !== submittedTitle ||
        JSON.stringify(latestEdits.current.document) !== JSON.stringify(submittedDocument);
      if (hasEditsDuringPublish) {
        setNotice("已发布提交时的版本；之后的新编辑仍保留在页面，请再次保存。");
      } else {
        setNotice("已发布，访客现在可以查看此版本。");
        setTitle(updated.title);
        setDocument(updated.document);
        navigate(`/${encodeURIComponent(slug)}/presentations/${encodeURIComponent(updated.id)}`, { replace: true });
      }
      await loadList();
    } catch (reason: any) {
      setError(
        reason?.response?.status === 409 || reason?.response?.status === 412
          ? "发布冲突：服务器版本已更新，请重新加载确认后再发布。"
          : "发布失败，请检查权限或稍后重试。"
      );
    } finally {
      setSaving(false);
    }
  };
  const createPresentation = async () => {
    if (!newTitle.trim() || !newProject) return;
    setSaving(true);
    setError("");
    try {
      const created = await presentationService.create(slug, {
        title: newTitle.trim(),
        project_id: newProject,
        document: { schema_version: 1, sections: [newSection()] },
      });
      setNewTitle("");
      await loadList();
      navigate(`/${encodeURIComponent(slug)}/presentations/${encodeURIComponent(created.id)}?view=draft&edit=1`);
    } catch {
      setError("创建失败，请确认项目权限后重试。");
    } finally {
      setSaving(false);
    }
  };
  const move = (direction: -1 | 1) => {
    const section = selected.section + direction;
    if (section >= 0 && section < document.sections.length) setSelected({ section, slide: 0 });
  };
  const openPreview = (item: PresentationMedia) =>
    item.can_preview && (item.file_url || item.preview_file_url) && setPreview(item);
  const searchSources = async () => {
    if (!sourceSearch.trim()) return;
    setError("");
    try {
      setSourceResults(await artifactService.sources(slug, sourceSearch.trim()));
    } catch {
      setError("工作项搜索失败，请检查访问权限后重试。");
    }
  };
  const chooseSource = async (source: ArtifactSource) => {
    setSelectedSource(source);
    setMaterialLoading(true);
    setError("");
    try {
      setSourceMaterials(await artifactService.materials(slug, source.id));
    } catch {
      setSourceMaterials([]);
      setError("无法读取该工作项的附件。");
    } finally {
      setMaterialLoading(false);
    }
  };
  const addMedia = (asset: ArtifactAsset) => {
    if (!slide || slide.media.some((item) => item.asset_id === asset.id)) return;
    setSlide(selected.section, selected.slide, (item) => ({
      ...item,
      media: [...item.media, { asset_id: asset.id, caption: asset.name }],
    }));
  };
  const revealHtml = useMemo(() => (current ? buildRevealDocument(document, REVEAL_VERSION) : ""), [current, document]);
  const openChapter = (index: number) => setSelected({ section: index, slide: editing ? -1 : 0 });

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-1 text-primary">
      <PageHead title="汇报与演示" />
      <div className="flex min-h-0 flex-1 flex-col">
        {!current && presentationId ? (
          <div className="mx-auto w-full max-w-2xl flex-1 p-8 text-center">
            <p role={detailLoading ? "status" : "alert"} className="text-14 text-secondary">
              {detailLoading ? "正在打开汇报…" : error || "无法打开这份汇报。"}
            </p>
            {!detailLoading && (
              <button
                className={button + " mt-5"}
                onClick={() => navigate(`/${encodeURIComponent(slug)}/presentations`)}
              >
                返回汇报列表
              </button>
            )}
          </div>
        ) : !current ? (
          <div className="mx-auto w-full max-w-6xl flex-1 overflow-auto px-4 py-8 sm:px-8">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-12 font-semibold tracking-[0.16em] text-accent-primary uppercase">PRESENTATIONS</p>
                <h1 className="mt-2 text-28 font-semibold">汇报与演示</h1>
                <p className="mt-2 max-w-2xl text-14 text-secondary">按章节组织内容，向下展开材料与细节。</p>
              </div>
              {canCreate && createProjectIds.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="新建汇报的项目"
                    className={input + " w-48"}
                    value={newProject}
                    onChange={(event) => setNewProject(event.target.value)}
                  >
                    <option value="">选择项目</option>
                    {createProjectIds.map((id) => (
                      <option key={id} value={id}>
                        {getProjectById(id)?.name ?? id}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label="汇报标题"
                    placeholder="汇报标题"
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    className="w-48"
                  />
                  <Button
                    disabled={!newProject || !newTitle.trim() || saving}
                    onClick={() => void createPresentation()}
                  >
                    <Plus className="mr-1 size-4" />
                    新建汇报
                  </Button>
                </div>
              ) : null}
            </div>
            {error && (
              <p role="alert" className="bg-danger/10 mb-5 rounded-lg p-3 text-13 text-danger-primary">
                {error}
              </p>
            )}
            {loading ? (
              <p role="status" className="py-16 text-center text-14 text-secondary">
                正在加载汇报…
              </p>
            ) : rows.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((item) => (
                  <button
                    key={item.id}
                    disabled={!item.published_revision_id && !item.can_edit}
                    onClick={() =>
                      navigate(
                        `/${encodeURIComponent(slug)}/presentations/${encodeURIComponent(item.id)}${item.published_revision_id ? "" : "?view=draft&edit=1"}`
                      )
                    }
                    className="group hover:border-accent-primary/50 hover:shadow-lg rounded-2xl border border-subtle-1 bg-layer-1 p-5 text-left transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <div className="mb-8 flex items-start justify-between">
                      <span className="rounded-full bg-accent-primary/10 px-2.5 py-1 text-11 font-medium text-accent-primary">
                        {item.published_revision_id ? "已发布" : "草稿"}
                        {item.has_unpublished_changes ? " · 有未发布更改" : ""}
                      </span>
                      <BookOpen className="size-5 text-secondary" />
                    </div>
                    <h2 className="text-18 font-semibold group-hover:text-accent-primary">{item.title}</h2>
                    <p className="mt-2 text-13 text-secondary">
                      {getProjectById(item.project_id)?.name ?? "工作区项目"}
                    </p>
                    <p className="mt-6 text-12 text-tertiary">
                      {item.published_revision_id ? "查看已发布版本" : item.can_edit ? "打开草稿" : "暂无已发布版本"}{" "}
                      <ArrowRight className="inline size-3" />
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-subtle-1 px-5 py-16 text-center">
                <BookOpen className="mx-auto size-8 text-tertiary" />
                <h2 className="mt-4 text-18 font-semibold">还没有汇报</h2>
                <p className="mt-2 text-13 text-secondary">选择一个项目并新建汇报，开始整理章节和内容。</p>
              </div>
            )}
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle-1 px-4 py-3 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  className={button}
                  onClick={() => {
                    if (isDirty && !window.confirm("还有未保存的更改，确定离开吗？")) return;
                    navigate(`/${encodeURIComponent(slug)}/presentations`);
                  }}
                >
                  <ArrowLeft className="size-4" />
                  <span className="hidden sm:inline">全部演示</span>
                </button>
                <div className="min-w-0">
                  {editing ? (
                    <Input
                      aria-label="汇报标题"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      className="h-8 max-w-64 text-14 font-semibold"
                    />
                  ) : (
                    <p className="truncate text-14 font-semibold">{current.title}</p>
                  )}
                  <p className="text-11 text-secondary">
                    {getProjectById(current.project_id)?.name ?? "工作区项目"} ·{" "}
                    {current.published_revision_id ? "已发布" : "未发布"}
                    {current.has_unpublished_changes ? " · 有未发布更改" : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {current.can_edit && (
                  <>
                    {editing ? (
                      <>
                        <Button variant="secondary" disabled={!isDirty || saving} onClick={() => void save()}>
                          <Save className="mr-1 size-4" />
                          {saving ? "保存中" : "保存"}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={saving || isDirty}
                          onClick={() =>
                            navigate(
                              `/${encodeURIComponent(slug)}/presentations/${encodeURIComponent(current.id)}?view=draft`
                            )
                          }
                        >
                          预览草稿
                        </Button>
                        <Button
                          disabled={
                            saving ||
                            isDirty ||
                            (!current.has_unpublished_changes && Boolean(current.published_revision_id))
                          }
                          onClick={() => void publish()}
                        >
                          发布
                        </Button>
                      </>
                    ) : draftView ? (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            navigate(
                              `/${encodeURIComponent(slug)}/presentations/${encodeURIComponent(current.id)}?view=draft&edit=1`
                            )
                          }
                        >
                          <Pencil className="mr-1 size-4" />
                          继续编辑
                        </Button>
                        <Button
                          disabled={
                            saving ||
                            isDirty ||
                            (!current.has_unpublished_changes && Boolean(current.published_revision_id))
                          }
                          onClick={() => void publish()}
                        >
                          发布
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          navigate(
                            `/${encodeURIComponent(slug)}/presentations/${encodeURIComponent(current.id)}?view=draft&edit=1`
                          )
                        }
                      >
                        <Pencil className="mr-1 size-4" />
                        编辑内容
                      </Button>
                    )}
                  </>
                )}
                {!editing && (
                  <button
                    className={button}
                    onClick={() => iframe.current?.requestFullscreen?.()}
                    aria-label="全屏演示"
                  >
                    <Maximize className="size-4" />
                    <span className="hidden sm:inline">全屏</span>
                  </button>
                )}
                <button
                  className={button}
                  onClick={() => {
                    if (isDirty && !window.confirm("还有未保存的更改，确定退出吗？")) return;
                    navigate(`/${encodeURIComponent(slug)}/presentations`);
                  }}
                  aria-label="退出演示"
                >
                  <X className="size-4" />
                  <span>退出</span>
                </button>
              </div>
            </header>
            {error && (
              <p role="alert" className="bg-danger/10 mx-4 mt-3 rounded-lg p-3 text-13 text-danger-primary sm:mx-6">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="bg-success/10 mx-4 mt-3 rounded-lg p-3 text-13 text-secondary sm:mx-6">
                {notice}
              </p>
            )}
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <aside className="max-h-40 shrink-0 overflow-auto border-b border-subtle-1 p-3 lg:max-h-none lg:w-64 lg:border-r lg:border-b-0">
                <p className="tracking-wider mb-2 px-2 text-11 font-semibold text-tertiary uppercase">章节与页面</p>
                <nav aria-label="汇报章节" className="space-y-1">
                  {document.sections.map((section, sectionIndex) => (
                    <div key={section.id}>
                      <button
                        onClick={() => openChapter(sectionIndex)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-13 font-semibold ${selected.section === sectionIndex ? "bg-accent-primary/10 text-accent-primary" : "hover:bg-surface-2"}`}
                      >
                        <ChevronDown
                          className={`size-3 transition ${selected.section === sectionIndex ? "" : "-rotate-90"}`}
                        />
                        <span className="truncate">
                          {sectionIndex + 1}. {section.title}
                        </span>
                      </button>
                      {selected.section === sectionIndex &&
                        section.slides.map((item, slideIndex) => (
                          <div key={item.id} className="ml-5 flex items-center gap-1">
                            <button
                              onClick={() => setSelected({ section: sectionIndex, slide: slideIndex })}
                              className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-12 ${selected.slide === slideIndex ? "bg-surface-2 font-medium" : "text-secondary hover:bg-surface-2"}`}
                            >
                              {item.title || `页面 ${slideIndex + 1}`}
                            </button>
                            {editing && (
                              <>
                                <button
                                  aria-label="页面上移"
                                  title="上移"
                                  disabled={slideIndex === 0}
                                  onClick={() => reorderSlide(sectionIndex, slideIndex, -1)}
                                  className="rounded px-1 text-11 text-secondary disabled:opacity-30"
                                >
                                  ↑
                                </button>
                                <button
                                  aria-label="页面下移"
                                  title="下移"
                                  disabled={slideIndex === section.slides.length - 1}
                                  onClick={() => reorderSlide(sectionIndex, slideIndex, 1)}
                                  className="rounded px-1 text-11 text-secondary disabled:opacity-30"
                                >
                                  ↓
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                    </div>
                  ))}
                  {editing && (
                    <button
                      className={button + " mt-3 w-full justify-center"}
                      onClick={() =>
                        setDocument((value) => ({ ...value, sections: [...value.sections, newSection()] }))
                      }
                    >
                      <Plus className="size-3" />
                      添加章节
                    </button>
                  )}
                </nav>
              </aside>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {editing && slide ? (
                  <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-7">
                    <div className="mx-auto max-w-3xl space-y-5">
                      <div>
                        <label className="mb-1 block text-12 font-medium text-secondary">汇报标题</label>
                        <Input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="汇报标题" />
                      </div>
                      <div className="flex items-center justify-between">
                        <h2 className="text-18 font-semibold">编辑页面</h2>
                      </div>
                      <label className="block text-12 font-medium text-secondary">
                        页面标题
                        <Input
                          className="mt-1"
                          value={slide.title}
                          onChange={(event) =>
                            setSlide(selected.section, selected.slide, (item) => ({
                              ...item,
                              title: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="block text-12 font-medium text-secondary">
                        正文（支持标题和粗体 Markdown）
                        <TextArea
                          className="mt-1 min-h-52"
                          value={slide.body}
                          onChange={(event) =>
                            setSlide(selected.section, selected.slide, (item) => ({
                              ...item,
                              body: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="block text-12 font-medium text-secondary">
                        演讲备注（仅编辑者可见）
                        <TextArea
                          className="mt-1 min-h-24"
                          value={slide.notes}
                          onChange={(event) =>
                            setSlide(selected.section, selected.slide, (item) => ({
                              ...item,
                              notes: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <fieldset className="space-y-2">
                        <legend className="text-12 font-medium text-secondary">外部链接</legend>
                        {slide.links.map((link, index) => (
                          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                            <Input
                              aria-label="链接名称"
                              placeholder="链接名称"
                              value={link.label}
                              onChange={(event) =>
                                setSlide(selected.section, selected.slide, (item) => ({
                                  ...item,
                                  links: item.links.map((value, i) =>
                                    i === index ? { ...value, label: event.target.value } : value
                                  ),
                                }))
                              }
                            />
                            <Input
                              aria-label="链接地址"
                              placeholder="https://…"
                              value={link.url}
                              onChange={(event) =>
                                setSlide(selected.section, selected.slide, (item) => ({
                                  ...item,
                                  links: item.links.map((value, i) =>
                                    i === index ? { ...value, url: event.target.value } : value
                                  ),
                                }))
                              }
                            />
                            <button
                              className={button}
                              onClick={() =>
                                setSlide(selected.section, selected.slide, (item) => ({
                                  ...item,
                                  links: item.links.filter((_, i) => i !== index),
                                }))
                              }
                            >
                              移除
                            </button>
                          </div>
                        ))}
                        <button
                          className={button}
                          onClick={() =>
                            setSlide(selected.section, selected.slide, (item) => ({
                              ...item,
                              links: [...item.links, { label: "", url: "" }],
                            }))
                          }
                        >
                          <Plus className="size-3" />
                          添加链接
                        </button>
                      </fieldset>
                      {canReadWorkItemDetails(slug) && slide.issue_ids.length > 0 && (
                        <fieldset className="space-y-2">
                          <legend className="text-12 font-medium text-secondary">相关工作项</legend>
                          <div className="flex flex-wrap gap-2">
                            {slide.issue_ids.map((issueId) => (
                              <a
                                key={issueId}
                                href={`/${encodeURIComponent(slug)}/projects/${encodeURIComponent(current.project_id)}/issues/${encodeURIComponent(issueId)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={button}
                              >
                                查看工作项
                              </a>
                            ))}
                          </div>
                        </fieldset>
                      )}
                      <fieldset className="space-y-2">
                        <legend className="text-12 font-medium text-secondary">配图</legend>
                        {slide.media.map((media) => (
                          <div
                            key={media.asset_id}
                            className="flex items-center gap-3 rounded-lg border border-subtle-1 p-3"
                          >
                            <span className="min-w-0 flex-1 truncate text-13">{media.filename ?? media.asset_id}</span>
                            <Input
                              aria-label="配图说明"
                              placeholder="配图说明"
                              value={media.caption}
                              onChange={(event) =>
                                setSlide(selected.section, selected.slide, (item) => ({
                                  ...item,
                                  media: item.media.map((value) =>
                                    value.asset_id === media.asset_id
                                      ? { ...value, caption: event.target.value }
                                      : value
                                  ),
                                }))
                              }
                            />
                            <button
                              className={button}
                              onClick={() =>
                                setSlide(selected.section, selected.slide, (item) => ({
                                  ...item,
                                  media: item.media.filter((value) => value.asset_id !== media.asset_id),
                                }))
                              }
                            >
                              移除
                            </button>
                          </div>
                        ))}
                        <div className="flex flex-wrap gap-2">
                          <Input
                            aria-label="搜索配图来源工作项"
                            className="min-w-48 flex-1"
                            placeholder="按工作项编号或名称搜索"
                            value={sourceSearch}
                            onChange={(event) => setSourceSearch(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void searchSources();
                              }
                            }}
                          />
                          <button type="button" className={button} onClick={() => void searchSources()}>
                            搜索工作项
                          </button>
                        </div>
                        {sourceResults.length > 0 && (
                          <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-subtle-1 p-2">
                            {sourceResults.map((source) => (
                              <button
                                key={source.id}
                                type="button"
                                className="block w-full rounded px-2 py-1.5 text-left text-12 hover:bg-surface-2"
                                onClick={() => void chooseSource(source)}
                              >
                                {source.identifier} · {source.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {selectedSource && (
                          <div className="rounded-lg border border-subtle-1 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2 text-12">
                              <span className="truncate font-medium">
                                材料来自：{selectedSource.identifier} · {selectedSource.name}
                              </span>
                              <button
                                type="button"
                                className="text-secondary underline"
                                onClick={() => setSelectedSource(null)}
                              >
                                关闭
                              </button>
                            </div>
                            {materialLoading ? (
                              <p role="status" className="text-12 text-secondary">
                                正在读取附件…
                              </p>
                            ) : sourceMaterials.length ? (
                              <div className="max-h-44 space-y-1 overflow-auto">
                                {sourceMaterials.map((asset) => {
                                  const included = slide.media.some((item) => item.asset_id === asset.id);
                                  return (
                                    <button
                                      key={asset.id}
                                      type="button"
                                      disabled={included}
                                      className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-12 hover:bg-surface-2 disabled:opacity-50"
                                      onClick={() => addMedia(asset)}
                                    >
                                      <span className="truncate">{asset.name}</span>
                                      <span className="shrink-0">{included ? "已加入" : "加入配图"}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-12 text-secondary">此工作项没有可用附件。</p>
                            )}
                          </div>
                        )}
                        <p className="text-12 text-tertiary">
                          只展示后端允许读取的工作项附件；预览地址由演示服务按访问权限返回。
                        </p>
                      </fieldset>
                      <div className="flex justify-between">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSection(selected.section, (item) => ({
                              ...item,
                              slides: item.slides.filter((_, index) => index !== selected.slide),
                            }));
                            setSelected({ section: selected.section, slide: -1 });
                          }}
                        >
                          删除此页
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const newIndex = document.sections[selected.section].slides.length;
                            setSection(selected.section, (item) => ({ ...item, slides: [...item.slides, newSlide()] }));
                            setSelected({ section: selected.section, slide: newIndex });
                          }}
                        >
                          <Plus className="mr-1 size-4" />
                          添加页面
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : editing && selected.slide === -1 ? (
                  <div className="min-h-0 flex-1 overflow-auto p-5">
                    <div className="mx-auto max-w-2xl">
                      <h2 className="text-20 font-semibold">章节设置</h2>
                      <label className="mt-5 block text-12 font-medium text-secondary">
                        章节名称
                        <Input
                          className="mt-1"
                          value={document.sections[selected.section]?.title ?? ""}
                          onChange={(event) =>
                            setSection(selected.section, (item) => ({ ...item, title: event.target.value }))
                          }
                        />
                      </label>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          disabled={selected.section === 0}
                          onClick={() => reorderSection(selected.section, -1)}
                        >
                          章节上移
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={selected.section === document.sections.length - 1}
                          onClick={() => reorderSection(selected.section, 1)}
                        >
                          章节下移
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            const index = selected.section;
                            const newIndex = document.sections[index].slides.length;
                            setSection(index, (item) => ({ ...item, slides: [...item.slides, newSlide()] }));
                            setSelected({ section: index, slide: newIndex });
                          }}
                        >
                          <Plus className="mr-1 size-4" />
                          添加页面
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (document.sections.length <= 1) return;
                            setDocument((value) => ({
                              ...value,
                              sections: value.sections.filter((_, index) => index !== selected.section),
                            }));
                            setSelected({ section: 0, slide: -1 });
                          }}
                        >
                          删除章节
                        </Button>
                      </div>
                      {document.sections[selected.section]?.slides.map((item, index) => (
                        <button
                          key={item.id}
                          onClick={() => setSelected({ section: selected.section, slide: index })}
                          className="mt-2 block w-full rounded-lg border border-subtle-1 p-3 text-left text-13 hover:bg-surface-2"
                        >
                          {index + 1}. {item.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="bg-slate-100 relative min-h-0 flex-1 p-2 sm:p-5">
                      <div className="shadow-sm relative mx-auto h-full max-w-6xl overflow-hidden rounded-2xl border border-subtle-1 bg-white">
                        <iframe
                          key={current.id}
                          ref={iframe}
                          title="汇报演示"
                          className="size-full border-0"
                          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                          referrerPolicy="no-referrer"
                          srcDoc={revealHtml}
                        />
                        <div className="absolute top-4 right-4 z-10 flex max-w-[90%] flex-wrap justify-end gap-2">
                          {slide?.media
                            .filter((item) => item.can_preview && item.file_url)
                            .map((item) => (
                              <button
                                key={item.asset_id}
                                title={item.caption || item.filename}
                                className={button + " shadow-sm max-w-56 bg-white/95"}
                                onClick={() => openPreview(item)}
                              >
                                <Paperclip className="size-3.5 shrink-0" />
                                <span className="truncate">{item.caption || item.filename || "查看原件"}</span>
                              </button>
                            ))}
                        </div>
                      </div>
                      {slide?.media.map((item) =>
                        item.can_preview && (item.file_url || item.preview_file_url) ? (
                          <button key={`media-${item.asset_id}`} onClick={() => openPreview(item)} className="sr-only">
                            查看 {item.caption || item.filename}
                          </button>
                        ) : null
                      )}
                    </div>
                    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle-1 px-4 py-3 sm:px-6">
                      <div className="min-w-0 text-12 text-secondary">
                        <span className="font-semibold text-primary">
                          {document.sections[selected.section]?.title ?? ""}
                        </span>
                        {slide ? <span> / {slide.title}</span> : null}
                        <span className="ml-2 text-tertiary">
                          · 第 {position.horizontal} / {Math.max(position.total, 1)} 页
                        </span>
                        {!editing && slide && canReadWorkItemDetails(slug) && slide.issue_ids.length > 0 && (
                          <span className="ml-3 inline-flex flex-wrap gap-x-2">
                            {slide.issue_ids.map((issueId) => (
                              <a
                                key={issueId}
                                href={`/${encodeURIComponent(slug)}/projects/${encodeURIComponent(current.project_id)}/issues/${encodeURIComponent(issueId)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-link-primary hover:underline"
                              >
                                来源工作项
                              </a>
                            ))}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="hidden text-11 text-secondary xl:inline">方向键导航 · 空格 / 回车下一页</span>
                        <button
                          className={button}
                          aria-label="上一章节"
                          disabled={selected.section === 0}
                          onClick={() => move(-1)}
                        >
                          <ChevronLeft className="size-4" />
                          <span className="hidden sm:inline">上一章节</span>
                        </button>
                        <button
                          className={button}
                          aria-label="下一章节"
                          disabled={selected.section >= document.sections.length - 1}
                          onClick={() => move(1)}
                        >
                          <span className="hidden sm:inline">下一章节</span>
                          <ChevronRight className="size-4" />
                        </button>
                      </div>
                    </footer>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      {preview && (
        <AttachmentPreviewModal
          fileName={preview.filename ?? preview.caption ?? "汇报配图"}
          fileURL={preview.file_url ?? preview.preview_file_url ?? ""}
          onClose={() => setPreview(null)}
        />
      )}
    </main>
  );
});

export default PresentationsPage;
