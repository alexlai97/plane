import { forwardRef, useEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@plane/propel/button";
import { Dialog, EDialogWidth } from "@plane/propel/dialog";
import { Input } from "@plane/propel/input";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { PageHead } from "@/components/core/page-title";
import { Breadcrumbs, EHeaderVariant, Header } from "@plane/ui";
import { artifactError } from "../../helpers/artifact";
export const inputClass =
  "w-full rounded-md border border-subtle-1 bg-surface-1 px-3 py-2 text-sm text-primary outline-none focus-visible:border-accent-primary focus-visible:ring-1 focus-visible:ring-accent-primary";
export const buttonClass =
  "rounded-md border border-subtle-1 bg-surface-1 px-4 py-2 text-sm text-secondary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
export const primaryClass =
  "rounded-md border border-accent-primary bg-accent-primary px-4 py-2 text-sm text-on-color hover:bg-accent-primary-hover disabled:cursor-not-allowed disabled:opacity-50";

export const ArtifactButton = forwardRef<HTMLButtonElement, ComponentProps<typeof Button>>(function ArtifactButton(
  { children, ...props },
  ref
) {
  return (
    <Button ref={ref} size="xl" {...props}>
      {children}
    </Button>
  );
});

export function CopyLinkButton() {
  const [manualValue, setManualValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (manualValue) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [manualValue]);
  const copy = async () => {
    const value = window.location.href;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "已复制", message: "成果链接已复制到剪贴板。" });
    } catch {
      setManualValue(value);
    }
  };
  return (
    <>
      <ArtifactButton variant="secondary" onClick={() => void copy()}>
        复制链接
      </ArtifactButton>
      {manualValue && (
        <Dialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setManualValue("");
          }}
        >
          <Dialog.Panel width={EDialogWidth.MD} className="p-5">
            <Dialog.Title className="text-16 font-semibold text-primary">手动复制成果链接</Dialog.Title>
            <p className="mt-2 text-13 text-secondary">浏览器未允许自动复制。链接已选中，请按 Ctrl+C 或 ⌘C 复制。</p>
            <Input
              ref={inputRef}
              readOnly
              aria-label="成果链接"
              value={manualValue}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-4 w-full rounded-md border border-subtle-1 bg-layer-2 px-3 py-2 text-13 text-primary"
            />
            <div className="mt-4 flex justify-end">
              <ArtifactButton variant="secondary" onClick={() => setManualValue("")}>
                完成
              </ArtifactButton>
            </div>
          </Dialog.Panel>
        </Dialog>
      )}
    </>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError("");
  }, [open]);
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (reason) {
      setError(artifactError(reason));
    } finally {
      setBusy(false);
    }
  };
  if (!open) return null;
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      <Dialog.Panel width={EDialogWidth.MD} className="p-5">
        <Dialog.Title className="text-16 font-semibold text-primary">{title}</Dialog.Title>
        <p className="mt-2 text-13 text-secondary">{description}</p>
        {error && (
          <p role="alert" className="mt-3 text-13 text-danger-primary">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <ArtifactButton variant="secondary" disabled={busy} onClick={onCancel}>
            取消
          </ArtifactButton>
          <ArtifactButton variant="error-fill" loading={busy} onClick={() => void confirm()}>
            {busy ? "处理中…" : confirmLabel}
          </ArtifactButton>
        </div>
      </Dialog.Panel>
    </Dialog>
  );
}
export function ArtifactShell({
  slug,
  title,
  children,
  actions,
  returnHref,
}: {
  slug: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  returnHref?: string;
}) {
  return (
    <div className="h-full overflow-y-auto bg-surface-1 text-primary">
      <PageHead title={title} />
      <Header variant={EHeaderVariant.TERNARY} className="min-h-11 border-b border-subtle bg-surface-1 px-4 md:px-8">
        <Header.LeftItem className="min-w-0">
          <Breadcrumbs className="min-w-0">
            <Breadcrumbs.Item
              component={
                <a href={returnHref ?? `/${slug}/gallery/`} className="text-13 text-link-primary hover:underline">
                  成果与应用
                </a>
              }
            />
            <Breadcrumbs.Item
              isLast
              component={<span className="max-w-48 truncate text-13 font-medium text-primary">{title}</span>}
            />
          </Breadcrumbs>
        </Header.LeftItem>
        <Header.RightItem>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </Header.RightItem>
      </Header>
      <div className="mx-auto max-w-6xl px-5 py-5 md:px-10">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{title}</h1>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-sm block space-y-2 font-medium">
      {" "}
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-subtle bg-surface-1 p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
export function Message({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {error && (
        <p
          role="alert"
          className="text-sm my-4 rounded-md border border-danger-strong bg-danger-subtle p-3 text-danger-primary"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="text-sm my-4 rounded-md border border-success-strong bg-success-subtle p-3 text-success-primary"
        >
          {message}
        </p>
      )}
    </>
  );
}
