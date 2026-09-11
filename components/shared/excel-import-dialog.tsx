"use client";

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
}) {
  const previewRows = rows.slice(0, 100);
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

      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left", margin: "14px 0" }}>
        <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} disabled={importing}/>
        <span><strong>Delete Existing Data</strong><br/><small>Replace the existing database rows in this screen with the rows from the Excel file.</small></span>
      </label>

      <div className="enterprise-table-wrap" style={{ maxHeight: 360, overflow: "auto", textAlign: "left" }}>
        <table className="enterprise-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{previewRows.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((column) => <td key={column}>{row[column] ?? ""}</td>)}</tr>)}</tbody></table>
      </div>
      {rows.length > previewRows.length && <p style={{ textAlign: "left" }}>Previewing first {previewRows.length} rows.</p>}

      {importing && <div style={{ marginTop: 16, textAlign: "left" }}>
        <div style={{ height: 10, borderRadius: 6, background: "#e5e7eb", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(0, Math.min(100, progress))}%`, background: "#2563eb", transition: "width .2s ease" }}/></div>
        <small>Importing… {Math.round(progress)}%</small>
      </div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
        <button className="button secondary" onClick={onCancel} disabled={importing}>Cancel</button>
        <button className="button primary" onClick={onImport} disabled={importing || rows.length === 0 || errors.length > 0}>{importing ? "Importing…" : "Import"}</button>
      </div>
    </div>
  </div>;
}
