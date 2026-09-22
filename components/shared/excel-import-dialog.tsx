"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExcelRow } from "@/lib/excel";

export default function ExcelImportDialog({
  title,
  rows,
  columns,
  errors,
  replace,
  setReplace,
  importing,
  progress,
  onCancel,
  onImport,
  showReplace = true,
  replaceLabel = "Delete Existing Data",
  replaceDescription = "Replace the existing database rows in this screen with the rows from the Excel file.",
}: {
  title: string;
  rows: ExcelRow[];
  columns: string[];
  errors: string[];
  replace: boolean;
  setReplace: (value: boolean) => void;
  importing: boolean;
  progress: number;
  onCancel: () => void;
  onImport: () => void;
  showReplace?: boolean;
  replaceLabel?: string;
  replaceDescription?: string;
}) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  const previewRows = rows.slice(0, 100);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const previewWidth = useMemo(() => Math.max(900, columns.length * 150), [columns.length]);

  useEffect(() => {
    if (!replace) setConfirmReplace(false);
  }, [replace]);

  useEffect(() => {
    const top = topScrollRef.current;
    const table = tableScrollRef.current;
    if (!top || !table) return;
    let syncing = false;
    const syncTop = () => {
      if (syncing) return;
      syncing = true;
      table.scrollLeft = top.scrollLeft;
      syncing = false;
    };
    const syncTable = () => {
      if (syncing) return;
      syncing = true;
      top.scrollLeft = table.scrollLeft;
      syncing = false;
    };
    top.addEventListener("scroll", syncTop);
    table.addEventListener("scroll", syncTable);
    return () => {
      top.removeEventListener("scroll", syncTop);
      table.removeEventListener("scroll", syncTable);
    };
  }, [previewWidth]);

  if (confirmReplace) return <div className="confirm-layer">
    <button className="confirm-scrim" onClick={() => !importing && setConfirmReplace(false)} aria-label="Close replacement confirmation" disabled={importing}/>
    <div className="confirm-dialog" role="alertdialog" aria-modal="true">
      <div className="confirm-icon">!</div>
      <h2>Replace Existing Data?</h2>
      <p>Are you sure? This will permanently delete the existing data for this screen and replace it with the rows from the Excel file.</p>
      <p><strong>This action cannot be undone.</strong></p>
      <div className="confirm-actions">
        <button className="button secondary" onClick={() => setConfirmReplace(false)} disabled={importing}>Cancel</button>
        <button className="button danger" onClick={onImport} disabled={importing}>{importing ? "Importing…" : "Yes, Delete and Replace"}</button>
      </div>
    </div>
  </div>;

  return <div className="confirm-layer">
    <button className="confirm-scrim" onClick={onCancel} aria-label="Close Excel import" disabled={importing}/>
    <div className="confirm-dialog" role="dialog" aria-modal="true" style={{ width: "min(1100px, 92vw)", maxWidth: 1100 }}>
      <h2>{title}</h2>
      <p>{rows.length} row{rows.length === 1 ? "" : "s"} found. Review the data and validation results before importing.</p>

      {errors.length > 0 && <div className="form-error" style={{ textAlign: "left", maxHeight: 150, overflow: "auto" }}>
        <strong>Import cannot proceed. Fix these issues in Excel first:</strong>
        <ul>{errors.slice(0, 50).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>
        {errors.length > 50 && <div>+ {errors.length - 50} more errors</div>}
      </div>}

      {showReplace && <label style={{ display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left", margin: "14px 0" }}>
        <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} disabled={importing}/>
        <span><strong>{replaceLabel}</strong><br/><small>{replaceDescription}</small></span>
      </label>}

      <div style={{ textAlign: "left", marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 5 }}>
          <small style={{ color: "#667085" }}>Previewing all {columns.length} columns. Use the horizontal scrollbar to view columns off-screen.</small>
          <small style={{ color: "#667085", whiteSpace: "nowrap" }}>{previewRows.length} preview row{previewRows.length === 1 ? "" : "s"}</small>
        </div>
        <div ref={topScrollRef} style={{ overflowX: "auto", overflowY: "hidden", height: 16, marginBottom: 4 }}>
          <div style={{ width: previewWidth, height: 1 }} />
        </div>
        <div ref={tableScrollRef} className="enterprise-table-wrap" style={{ maxHeight: 360, overflow: "auto", textAlign: "left" }}>
          <table className="enterprise-table" style={{ minWidth: previewWidth, width: previewWidth, tableLayout: "auto" }}>
            <thead><tr>{columns.map((column) => <th key={column} style={{ minWidth: 140, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 }}>{column}</th>)}</tr></thead>
            <tbody>{previewRows.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((column) => <td key={column} style={{ minWidth: 140, whiteSpace: "nowrap" }}>{row[column] ?? ""}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
      {rows.length > previewRows.length && <p style={{ textAlign: "left" }}>Previewing first {previewRows.length} rows.</p>}

      {importing && <div style={{ marginTop: 16, textAlign: "left" }}>
        <div style={{ height: 10, borderRadius: 6, background: "#e5e7eb", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(0, Math.min(100, progress))}%`, background: "#2563eb", transition: "width .2s ease" }}/></div>
        <small>Importing… {Math.round(progress)}%</small>
      </div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
        <button className="button secondary" onClick={onCancel} disabled={importing}>Cancel</button>
        <button className="button primary" onClick={() => replace && showReplace ? setConfirmReplace(true) : onImport()} disabled={importing || rows.length === 0 || errors.length > 0}>{importing ? "Importing…" : "Import"}</button>
      </div>
    </div>
  </div>;
}
