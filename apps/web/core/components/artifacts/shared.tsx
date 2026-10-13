import type { ReactNode } from "react";
import { PageHead } from "@/components/core/page-title";
export const inputClass =
  "w-full rounded-md border border-[#cad7e4] bg-white px-3 py-2 text-sm text-[#19334d] outline-none focus:border-[#2d628b] focus:ring-1 focus:ring-[#2d628b]";
export const buttonClass =
  "rounded-md border border-[#cad7e4] bg-white px-4 py-2 text-sm text-[#244866] hover:bg-[#edf3f9] disabled:cursor-not-allowed disabled:opacity-50";
export const primaryClass =
  "rounded-md border border-[#2d628b] bg-[#2d628b] px-4 py-2 text-sm text-white hover:bg-[#244f73] disabled:cursor-not-allowed disabled:opacity-50";
export function ArtifactShell({
  slug,
  title,
  children,
  actions,
}: {
  slug: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto bg-[#f5f8fc] text-[#19334d]">
      <PageHead title={title} />
      <div className="mx-auto max-w-6xl px-5 py-7 md:px-10">
        <a className="text-sm text-[#2d628b] hover:underline" href={`/${slug}/gallery/`}>
          ← 返回成果与应用
        </a>
        <header className="my-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <div className="flex flex-wrap gap-2">{actions}</div>
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
    <section className="space-y-4 rounded-xl border border-[#dce5ef] bg-white p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
export function Message({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="border-red-200 bg-red-50 text-sm text-red-800 my-4 rounded-md border p-3">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="border-green-200 bg-green-50 text-sm text-green-800 my-4 rounded-md border p-3">
          {message}
        </p>
      )}
    </>
  );
}
