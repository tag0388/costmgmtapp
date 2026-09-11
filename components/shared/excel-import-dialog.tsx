"use client";

import { useMemo, useState } from "react";
import { ExcelRow } from "@/lib/excel";

export type ImportValidationResult = { errors: string[]; warnings?: string[] };

export default function ExcelImportDialog({
  title,
  fileName,
  rows,
  columns,
  validateRows,
  onClose,
  onImport,
  replaceWarning = "Are you sure you want to replace? This will delete all data and can't be undone.",
}: {
  title: string;
  fileName: string;
  rows: ExcelRow[];
  columns: string[];
  validateRows: (rows: ExcelRow[]) => ImportValidationResult;
  onClose: () => void;
  onImport: (rows: ExcelRow[], replace: boolean, progress: (done: number, total: number) => void) => Promise<void>;
  replaceWarning?: string;
}) {
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [runtimeError, setRuntimeError] = useState("");
  const validation = useMemo(() => validateRows(rows), [rows, validateRows]);
  const canImport = rows.length > 0 && validation.errors.length === 0 && !importing;

  async function runImport() {
    if (!canImport) return;
    if (replace && !window.confirm(replaceWarning)) return;
    setImporting(true);
    setRuntimeError("");
    setProgress({ done: 0, total: rows.length });
    try {
      await onImport(rows, replace, (done, total) => setProgress({ done, total }));
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Import failed.");
      setImporting(false);
    }
  }

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return <div className="bulk-modal-layer" role="presentation">
    <button className="bulk-modal-scrim" onClick={importing ? undefined : onClose} aria-label="Close import preview" />
    <section className="bulk-modal" role="dialog" aria-modal="true" aria-labelledby="excel-import-title">
      <header><div><span>Excel import</span><h2 id="excel-import-title">{title}</h2><p>{fileName} · {rows.length} data row{rows.length === 1 ? "" : "s"}</p></div><button disabled={importing} onClick={onClose} aria-label="Close">×</button></header>
      <div className="bulk-modal-body">
        {validation.errors.length > 0 && <div className="import-validation error"><strong>Import cannot proceed</strong><span>Fix these issues in Excel and import the file again.</span><ul>{validation.errors.slice(0, 20).map((message, index) => <li key={index}>{message}</li>)}</ul>{validation.errors.length > 20 && <small>+{validation.errors.length - 20} more errors</small>}</div>}
        {validation.warnings?.length ? <div className="import-validation warning"><strong>Review</strong><ul>{validation.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul></div> : null}
        <div className="import-preview-wrap"><table className="import-preview"><thead><tr><th>#</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}><td>{index + 2}</td>{columns.map((column) => <td key={column}>{row[column] ?? ""}</td>)}</tr>)}</tbody></table>{rows.length > 100 && <div className="preview-note">Showing first 100 rows. All {rows.length} rows will be imported.</div>}</div>
        <label className="replace-data-option"><input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} disabled={importing}/><span><strong>Delete Existing Data</strong><small>Replace the existing dataset with the validated rows from this workbook.</small></span></label>
        {runtimeError && <div className="form-error">{runtimeError}</div>}
        {importing && <div className="import-progress"><div><strong>Importing…</strong><span>{progress.done} of {progress.total}</span></div><progress value={progress.done} max={Math.max(progress.total, 1)} /><small>{percent}% complete</small></div>}
      </div>
      <footer><button className="button secondary" disabled={importing} onClick={onClose}>Cancel</button><button className="button primary" disabled={!canImport} onClick={() => void runImport()}>{importing ? "Importing…" : "Import"}</button></footer>
    </section>
  </div>;
}
