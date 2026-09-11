"use client";

import { useRef } from "react";

type ActionName = "edit" | "delete" | "import" | "export";

function ActionIcon({ name }: { name: ActionName }) {
  if (name === "edit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm10-14 4 4"/></svg>;
  if (name === "delete") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>;
  if (name === "import") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M4 20h16"/></svg>;
}

export function IconActionButton({ action, label, onClick, disabled, danger }: { action: ActionName; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return <button type="button" className={`table-icon-action ${danger ? "danger" : ""}`} title={label} aria-label={label} onClick={(event) => { event.stopPropagation(); onClick(); }} disabled={disabled}><ActionIcon name={action}/></button>;
}

export function ImportFileButton({ label = "Import from Excel", onFile }: { label?: string; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <><button type="button" className="table-icon-action" title={label} aria-label={label} onClick={() => inputRef.current?.click()}><ActionIcon name="import"/></button><input ref={inputRef} className="hidden-file-input" type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = ""; }}/></>;
}

export function ToolbarIconGroup({ children }: { children: React.ReactNode }) {
  return <div className="table-toolbar-icons">{children}</div>;
}

export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="row-action-icons">{children}</div>;
}
