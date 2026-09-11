"use client";

import { useState } from "react";
import { ExcelColumn, ExcelRow } from "@/lib/excel-browser";

export type ImportIssue = { row?: number; message: string };

export default function ExcelImportDialog({
  title,
  fileName,
  rows,
  columns,
  issues,
  deleteExisting,
  destructiveMessage,
  importing,
  progress,
  onDeleteExistingChange,
  onClose,
  onImport,
}: {
  title: string;
  fileName: string;
  rows: ExcelRow[];
  columns: ExcelColumn[];
  issues: ImportIssue[];
  deleteExisting: boolean;
  destructiveMessage: string;
  importing: boolean;
  progress: number;
  onDeleteExistingChange: (value: boolean) => void;
  onClose: () => void;
  onImport: () => Promise<void>;
}) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  const invalid = issues.length > 0 || rows.length === 0;

  function requestImport() {
    if (invalid || importing) return;
    if (deleteExisting) setConfirmReplace(true);
    else void onImport();
  }

  return <div className="excel-import-layer" role="dialog" aria-modal="true" aria-labelledby="excel-import-title">
    <button className="excel-import-scrim" onClick={importing ? undefined : onClose} aria-label="Close import preview" />
    <section className="excel-import-dialog">
      <header>
        <div><span>Excel Import</span><h2 id="excel-import-title">{title}</h2><p>{fileName} · {rows.length} row{rows.length === 1 ? "" : "s"}</p></div>
        <button onClick={onClose} disabled={importing} aria-label="Close">×</button>
      </header>

      <div className="excel-import-body">
        {issues.length > 0 && <div className="excel-import-errors"><strong>Import cannot proceed until these errors are fixed:</strong><ul>{issues.slice(0, 20).map((issue, index) => <li key={`${issue.row ?? 0}-${index}`}>{issue.row ? `Row ${issue.row}: ` : ""}{issue.message}</li>)}</ul>{issues.length > 20 && <small>+{issues.length - 20} more errors</small>}</div>}
        {rows.length === 0 && <div className="excel-import-errors"><strong>No data rows were found in the workbook.</strong></div>}

        <label className="excel-delete-existing">
          <input type="checkbox" checked={deleteExisting} disabled={importing} onChange={(event) => onDeleteExistingChange(event.target.checked)} />
          <span><strong>Delete Existing Data</strong><small>Replace existing database rows with the data in this workbook.</small></span>
        </label>

        <div className="excel-preview-wrap">
          <table className="excel-preview-table"><thead><tr><th>#</th>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, rowIndex) => <tr key={rowIndex}><td>{rowIndex + 2}</td>{columns.map((column) => <td key={column.key}>{row[column.label] ?? row[column.key] ?? ""}</td>)}</tr>)}</tbody></table>
        </div>
        {rows.length > 100 && <div className="excel-preview-note">Previewing the first 100 of {rows.length} data rows.</div>}

        {importing && <div className="excel-progress"><div><span>Importing…</span><strong>{Math.round(progress)}%</strong></div><progress max={100} value={progress}/></div>}
      </div>

      <footer><button className="button secondary" disabled={importing} onClick={onClose}>Cancel</button><button className="button primary" disabled={invalid || importing} onClick={requestImport}>{importing ? "Importing…" : "Import"}</button></footer>
    </section>

    {confirmReplace && <div className="excel-confirm-layer"><div className="confirm-dialog" role="alertdialog" aria-modal="true"><div className="confirm-icon">!</div><h2>Are you sure you want to replace?</h2><p>{destructiveMessage}</p><p><strong>This will delete all existing data covered by this import and cannot be undone.</strong></p><div><button className="button secondary" onClick={() => setConfirmReplace(false)}>No, go back</button><button className="button danger" onClick={() => { setConfirmReplace(false); void onImport(); }}>Yes, replace data</button></div></div></div>}
  </div>;
}
