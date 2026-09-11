"use client";

import { useState } from "react";

export type ImportPreviewColumn = { key: string; label: string };

export default function ExcelImportDialog({
  title,
  rows,
  columns,
  errors,
  deleteExisting,
  onDeleteExistingChange,
  onClose,
  onImport,
  importing,
  progress,
  replaceWarning = "Are you sure you want to replace? This will delete all data and can't be undone.",
}: {
  title: string;
  rows: Record<string, string>[];
  columns: ImportPreviewColumn[];
  errors: string[];
  deleteExisting: boolean;
  onDeleteExistingChange: (value: boolean) => void;
  onClose: () => void;
  onImport: () => Promise<void>;
  importing: boolean;
  progress: number;
  replaceWarning?: string;
}) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  const hasErrors = errors.length > 0;
  const previewRows = rows.slice(0, 50);

  async function requestImport() {
    if (deleteExisting && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    await onImport();
  }

  return <div className="excel-modal-layer" role="presentation">
    <button className="excel-modal-scrim" onClick={importing ? undefined : onClose} aria-label="Close import preview" />
    <section className="excel-import-dialog" role="dialog" aria-modal="true" aria-labelledby="excel-import-title">
      <header>
        <div><span>Excel import</span><h2 id="excel-import-title">{title}</h2></div>
        <button onClick={onClose} disabled={importing} aria-label="Close">×</button>
      </header>
      <div className="excel-import-body">
        <div className={`excel-validation-summary ${hasErrors ? "invalid" : "valid"}`}>
          <strong>{hasErrors ? `${errors.length} validation issue${errors.length === 1 ? "" : "s"} found` : `${rows.length} row${rows.length === 1 ? "" : "s"} ready to import`}</strong>
          <span>{hasErrors ? "Fix the workbook and import it again. Import cannot proceed while errors exist." : "Review the preview below before importing."}</span>
        </div>

        {hasErrors && <div className="excel-error-list">{errors.slice(0, 20).map((error, index) => <div key={`${index}-${error}`}>{error}</div>)}{errors.length > 20 && <strong>+ {errors.length - 20} more validation issues</strong>}</div>}

        <label className="excel-replace-toggle">
          <input type="checkbox" checked={deleteExisting} disabled={importing} onChange={(event) => { onDeleteExistingChange(event.target.checked); setConfirmReplace(false); }} />
          <span><strong>Delete Existing Data</strong><small>Replace the current table data with the workbook instead of merging changes.</small></span>
        </label>

        <div className="excel-preview-wrap">
          <table className="excel-preview-table">
            <thead><tr><th>#</th>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
            <tbody>{previewRows.map((row, index) => <tr key={index}><td>{index + 2}</td>{columns.map((column) => <td key={column.key} title={row[column.key] ?? ""}>{row[column.key] || "—"}</td>)}</tr>)}</tbody>
          </table>
          {rows.length > previewRows.length && <div className="excel-preview-note">Showing first {previewRows.length} of {rows.length} rows.</div>}
        </div>

        {importing && <div className="excel-progress"><div><span>Importing…</span><strong>{Math.round(progress)}%</strong></div><progress max={100} value={progress} /></div>}

        {confirmReplace && !importing && <div className="excel-replace-warning"><strong>Confirm replacement</strong><p>{replaceWarning}</p><div><button className="button secondary" onClick={() => setConfirmReplace(false)}>No, go back</button><button className="button danger" onClick={() => void onImport()}>Yes, replace data</button></div></div>}
      </div>
      <footer>
        <button className="button secondary" onClick={onClose} disabled={importing}>Cancel</button>
        <button className="button primary" disabled={hasErrors || rows.length === 0 || importing} onClick={() => void requestImport()}>{importing ? "Importing…" : deleteExisting ? "Replace from Excel" : "Import from Excel"}</button>
      </footer>
    </section>
  </div>;
}
