"use client";

import { useRef } from "react";

export type ImportPreviewRow = { rowNumber: number; values: Record<string, string>; errors: string[] };

export default function ExcelImportDialog({
  title,
  rows,
  columns,
  replaceExisting,
  setReplaceExisting,
  importing,
  progress,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  rows: ImportPreviewRow[];
  columns: string[];
  replaceExisting: boolean;
  setReplaceExisting: (value: boolean) => void;
  importing: boolean;
  progress: number;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const confirmedReplace = useRef(false);
  const invalidCount = rows.filter((row) => row.errors.length).length;
  const canImport = rows.length > 0 && invalidCount === 0 && !importing;

  function confirmImport() {
    if (replaceExisting && !confirmedReplace.current) {
      if (!window.confirm("Are you sure you want to replace? This will delete all data and can't be undone.")) return;
      confirmedReplace.current = true;
    }
    onConfirm();
  }

  return <div className="import-modal-layer">
    <button className="import-modal-scrim" onClick={onClose} aria-label="Close import preview" disabled={importing}/>
    <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
      <header><div><span>Excel Import</span><h2 id="import-preview-title">{title}</h2><p>Review and validate the spreadsheet before making database changes.</p></div><button onClick={onClose} disabled={importing} aria-label="Close">×</button></header>
      <div className="import-summary"><strong>{rows.length} row{rows.length === 1 ? "" : "s"}</strong><span className={invalidCount ? "import-invalid" : "import-valid"}>{invalidCount ? `${invalidCount} row${invalidCount === 1 ? "" : "s"} with errors` : "Validation passed"}</span></div>
      {error && <div className="form-error">{error}</div>}
      <div className="import-preview-table-wrap"><table className="enterprise-table import-preview-table"><thead><tr><th>Excel Row</th>{columns.map((column) => <th key={column}>{column}</th>)}<th>Validation</th></tr></thead><tbody>{rows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? "import-row-error" : ""}><td>{row.rowNumber}</td>{columns.map((column) => <td key={column}>{row.values[column] || "—"}</td>)}<td>{row.errors.length ? <ul>{row.errors.map((message) => <li key={message}>{message}</li>)}</ul> : <span className="import-valid">✓ Ready</span>}</td></tr>)}</tbody></table></div>
      <label className="replace-checkbox"><input type="checkbox" checked={replaceExisting} onChange={(event) => { setReplaceExisting(event.target.checked); confirmedReplace.current = false; }} disabled={importing}/><span><strong>Delete Existing Data</strong><small>Replace the existing database rows with the rows in this Excel file.</small></span></label>
      {importing && <div className="import-progress"><div><span>Importing…</span><strong>{Math.round(progress)}%</strong></div><progress max="100" value={progress}/></div>}
      <footer><button className="button secondary" onClick={onClose} disabled={importing}>Cancel</button><button className="button primary" onClick={confirmImport} disabled={!canImport}>{importing ? "Importing…" : invalidCount ? "Fix validation errors first" : "Import"}</button></footer>
    </section>
  </div>;
}
