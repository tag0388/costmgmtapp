"use client";

import { useEffect, useMemo, useState } from "react";
import { ExcelColumn, ExcelRow, readExcel } from "@/lib/excel";

type ValidationIssue = { row: number; message: string };

type Validated<T> = { rows: T[]; issues: ValidationIssue[] };

export default function ExcelImportDialog<T>({ title, description, columns, file, validate, onClose, onImport }: {
  title: string;
  description?: string;
  columns: ExcelColumn[];
  file: File;
  validate: (rows: ExcelRow[]) => Validated<T>;
  onClose: () => void;
  onImport: (rows: T[], deleteExisting: boolean, reportProgress: (completed: number, total: number) => void) => Promise<void>;
}) {
  const [rawRows, setRawRows] = useState<ExcelRow[] | null>(null);
  const [readError, setReadError] = useState("");
  const [deleteExisting, setDeleteExisting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    setRawRows(null);
    setReadError("");
    void readExcel(file).then((rows) => { if (!cancelled) setRawRows(rows); }).catch((error) => { if (!cancelled) setReadError(error instanceof Error ? error.message : "Unable to read the workbook."); });
    return () => { cancelled = true; };
  }, [file]);

  const validation = useMemo(() => rawRows ? validate(rawRows) : { rows: [] as T[], issues: [] as ValidationIssue[] }, [rawRows, validate]);
  const previewRows = rawRows?.slice(0, 100) ?? [];
  const canImport = Boolean(rawRows && rawRows.length > 0 && validation.issues.length === 0 && !importing);
  const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  async function runImport() {
    setConfirmReplace(false);
    setImporting(true);
    setImportError("");
    setProgress({ completed: 0, total: Math.max(validation.rows.length, 1) });
    try {
      await onImport(validation.rows, deleteExisting, (completed, total) => setProgress({ completed, total: Math.max(total, 1) }));
      onClose();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function requestImport() {
    if (!canImport) return;
    if (deleteExisting) setConfirmReplace(true);
    else void runImport();
  }

  return <div className="excel-import-layer" role="dialog" aria-modal="true" aria-labelledby="excel-import-title">
    <button className="excel-import-scrim" onClick={importing ? undefined : onClose} aria-label="Close Excel import"/>
    <section className="excel-import-dialog">
      <header><div><span>Excel Import</span><h2 id="excel-import-title">{title}</h2>{description && <p>{description}</p>}</div><button onClick={onClose} disabled={importing} aria-label="Close">×</button></header>
      <div className="excel-import-body">
        <div className="excel-file-summary"><strong>{file.name}</strong><span>{rawRows ? `${rawRows.length} data row${rawRows.length === 1 ? "" : "s"}` : "Reading workbook…"}</span></div>
        {readError && <div className="form-error">{readError}</div>}
        {validation.issues.length > 0 && <div className="excel-validation-errors"><strong>Import cannot proceed. Fix these errors in Excel and upload the file again.</strong><ul>{validation.issues.slice(0, 30).map((issue, index) => <li key={`${issue.row}-${index}`}>Row {issue.row}: {issue.message}</li>)}</ul>{validation.issues.length > 30 && <span>+ {validation.issues.length - 30} more errors</span>}</div>}
        {importError && <div className="form-error">{importError}</div>}
        {rawRows && rawRows.length > 0 && <div className="excel-preview-wrap"><table className="excel-preview-table"><thead><tr><th>Row</th>{columns.map((column) => <th key={column.key}>{column.header}</th>)}</tr></thead><tbody>{previewRows.map((row, rowIndex) => <tr key={rowIndex}><td>{rowIndex + 2}</td>{columns.map((column) => <td key={column.key}>{row[column.header] ?? ""}</td>)}</tr>)}</tbody></table>{rawRows.length > previewRows.length && <div className="excel-preview-note">Showing first {previewRows.length} of {rawRows.length} rows.</div>}</div>}
        <label className="excel-delete-existing"><input type="checkbox" checked={deleteExisting} onChange={(event) => setDeleteExisting(event.target.checked)} disabled={importing}/><span><strong>Delete Existing Data</strong><small>Replace the existing active dataset with the rows in this workbook.</small></span></label>
        {importing && <div className="excel-progress"><div><strong>Importing…</strong><span>{progress.completed} of {progress.total} · {percentage}%</span></div><progress max={progress.total} value={progress.completed}/></div>}
      </div>
      <footer><button className="button secondary" onClick={onClose} disabled={importing}>Cancel</button><button className="button primary" onClick={requestImport} disabled={!canImport}>{importing ? "Importing…" : "Import"}</button></footer>
    </section>
    {confirmReplace && <div className="replace-confirm-layer"><div className="replace-confirm"><div className="confirm-icon">!</div><h3>Replace existing data?</h3><p>Are you sure you want to replace? This will delete all data and can't be undone.</p><div><button className="button secondary" onClick={() => setConfirmReplace(false)}>No</button><button className="button danger" onClick={() => void runImport()}>Yes, Replace</button></div></div></div>}
  </div>;
}
