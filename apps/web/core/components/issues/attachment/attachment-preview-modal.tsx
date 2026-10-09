/* oxlint-disable react/iframe-missing-sandbox -- The generated viewer requires scripts and same-origin authenticated resource requests. This sandbox limits navigation; it is not an isolation boundary for arbitrary HTML. HTML/SVG attachments are excluded from preview. */
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@headlessui/react";
import { Download, ExternalLink, RefreshCw, X } from "lucide-react";

export function AttachmentPreviewModal({
  fileName,
  fileURL,
  onClose,
}: {
  fileName: string;
  fileURL: string;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const closeFromPreview = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === iframeRef.current?.contentWindow &&
        event.data?.type === "bokang:close-attachment-preview"
      )
        onClose();
    };
    window.addEventListener("message", closeFromPreview);
    return () => window.removeEventListener("message", closeFromPreview);
  }, [onClose]);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const previewURL = `${fileURL.replace(/\/$/, "")}/preview/onlinePreview`;
  const actionClass =
    "flex items-center gap-1.5 rounded-md border border-subtle px-3 py-2 text-13 text-secondary hover:bg-layer-1";
  return (
    <Dialog
      open
      onClose={onClose}
      data-prevent-outside-click
      data-bokang-attachment-preview
      className="relative z-[100]"
    >
      <div className="fixed inset-0 bg-black/35" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-2 sm:p-5">
        <Dialog.Panel
          data-prevent-outside-click
          className="shadow-xl flex h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-subtle bg-surface-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-16 font-semibold text-primary">{fileName}</Dialog.Title>
              <p className="mt-1 text-12 text-secondary">附件预览 · 泊康项目管理系统</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={actionClass}
                onClick={() => {
                  setLoaded(false);
                  setAttempt((value) => value + 1);
                }}
                title="重新加载预览"
              >
                <RefreshCw size={15} />
                <span className="hidden sm:inline">重试</span>
              </button>
              <a className={actionClass} href={fileURL} target="_blank" rel="noopener noreferrer">
                <Download size={15} />
                <span>下载</span>
              </a>
              <a className={actionClass} href={previewURL} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} />
                <span className="hidden sm:inline">新窗口打开</span>
              </a>
              <button className={actionClass} onClick={onClose} aria-label="关闭附件预览">
                <X size={18} />
              </button>
            </div>
          </div>
          {!loaded && (
            <div role="status" className="border-b border-subtle bg-layer-1 px-4 py-2 text-13 text-secondary">
              正在加载预览，较大的 Office 文档首次打开可能需要转换…
            </div>
          )}
          <iframe
            ref={iframeRef}
            key={attempt}
            title={`${fileName}附件预览`}
            src={previewURL}
            className="min-h-0 w-full flex-1 border-0 bg-white"
            onLoad={() => setLoaded(true)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
            referrerPolicy="no-referrer"
          />
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
