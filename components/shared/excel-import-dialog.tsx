"use client";

import { useState } from "react";

export type ImportPreviewColumn = { key: string; label: string };
export type ImportPreviewRow = Record<string, string>;

export default function ExcelImportDialog({
  title,
  subtitle,
  rows,
  columns,
  errors,
  deleteExisting,
  onDeleteExistingChange,
  onClose,
  onImport,
  importing,
  progress,
  deleteWarning = "Are you sure you want to replace? This will delete all data and can't be undone.",
}: {
  title: string;
  subtitle?: string;
  rows: ImportPreviewRow[];
  columns: ImportPreviewColumn[];
  errors: string[];
  deleteExisting: boolean;
  onDeleteExistingChange: (value: boolean) => void;
  onClose: () => void;
  onImport: () => Promise<void>;
  importing: boolean;
  progress: number;
  deleteWarning?: string;
}) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  const blocked = errors.length > 0 || rows.length === 0;

  async function startImport() {
    if (blocked || importing) return;
    if (deleteExisting && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setConfirmReplace(false);
    await onImport();
  }

  return <div className="bulk-dialog-layer">
    <button className="bulk-dialog-scrim" aria-label="Close import preview" onClick={importing ? undefined : onClose} />
    <section className="bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="excel-import-title">
      <header>
        <div><span>Excel import</span><h2 id="excel-import-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button aria-label="Close" onClick={onClose} disabled={importing}>×</button>
      </header>

      <div className="bulk-dialog-body">
        {errors.length > 0 && <div className="import-errors"><strong>Import cannot continue until these errors are fixed:</strong><ul>{errors.slice(0, 12).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>{errors.length > 12 && <span>+ {errors.length - 12} more errors</span>}</div>}

        <div className="import-summary"><strong>{rows.length} row{rows.length === 1 ? "" : "s"} found</strong><span>Review the workbook data before importing.</span></div>
        <div className="import-preview-wrap"><table className="import-preview-table"><thead><tr><th>Row</th>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}><td>{index + 2}</td>{columns.map((column) => <td key={column.key} title={row[column.key] ?? ""}>{row[column.key] || <span className="muted-value">—</span>}</td>)}</tr>)}</tbody></table>{rows.length > 100 && <div className="import-preview-more">Preview shows first 100 rows. All {rows.length} rows will be imported.</div>}</div>

        <label className="danger-checkbox"><input type="checkbox" checked={deleteExisting} onChange={(event) => { onDeleteExistingChange(event.target.checked); setConfirmReplace(false); }} disabled={importing}/><span><strong>Delete Existing Data</strong><small>Replace the existing records with the workbook data instead of merging.</small></span></label>

        {confirmReplace && <div className="replace-confirm"><strong>{deleteWarning}</strong><span>Click Yes, replace data to continue, or Cancel to go back.</span><div><button className="button secondary" onClick={() => setConfirmReplace(false)} disabled={importing}>Cancel</button><button className="button danger" onClick={() => void startImport()} disabled={importing}>Yes, replace data</button></div></div>}

        {importing && <div className="import-progress" role="status" aria-live="polite"><div><strong>Importing…</strong><span>{Math.round(progress)}%</span></div><progress value={progress} max={100}/><small>Do not close this window until the import completes.</small></div>}
      </div>

      <footer>
        <button className="button secondary" onClick={onClose} disabled={importing}>Cancel</button>
        {!confirmReplace && <button className="button primary" onClick={() => void startImport()} disabled={blocked || importing}>{importing ? "Importing…" : "Import"}</button>}
      </footer>
    </section>
  </div>;
}
