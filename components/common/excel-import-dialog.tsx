"use client";

export type ImportPreviewColumn = { key: string; label: string };
export type ImportPreviewRow = Record<string, string>;

export default function ExcelImportDialog({ title, rows, columns, errors, deleteExisting, onDeleteExistingChange, onCancel, onImport, importing, progress, replaceWarning }: { title: string; rows: ImportPreviewRow[]; columns: ImportPreviewColumn[]; errors: string[]; deleteExisting: boolean; onDeleteExistingChange: (value: boolean) => void; onCancel: () => void; onImport: () => void; importing: boolean; progress: number; replaceWarning: string }) {
  const canImport = rows.length > 0 && errors.length === 0 && !importing;
  return <div className="bulk-modal-layer">
    <button className="bulk-modal-scrim" onClick={importing ? undefined : onCancel} aria-label="Close import preview" />
    <section className="bulk-modal" role="dialog" aria-modal="true" aria-labelledby="excel-import-title">
      <header><div><span>Excel Import</span><h2 id="excel-import-title">{title}</h2></div><button onClick={onCancel} disabled={importing} aria-label="Close">×</button></header>
      <div className="bulk-modal-body">
        <div className="import-summary"><strong>{rows.length} row{rows.length === 1 ? "" : "s"} ready for validation</strong><span>Review the imported worksheet before committing changes.</span></div>
        {errors.length > 0 && <div className="import-errors"><strong>Import cannot proceed</strong>{errors.map((error, index) => <span key={`${error}-${index}`}>• {error}</span>)}</div>}
        <div className="import-preview-wrap"><table className="enterprise-table import-preview-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.key}>{row[column.key] || "—"}</td>)}</tr>)}</tbody></table></div>
        {rows.length > 100 && <div className="import-preview-note">Showing the first 100 of {rows.length} rows.</div>}
        <label className="replace-checkbox"><input type="checkbox" checked={deleteExisting} disabled={importing} onChange={(event) => onDeleteExistingChange(event.target.checked)} /><span><strong>Delete Existing Data</strong><small>Replace the current dataset with the rows in this Excel file.</small></span></label>
        {deleteExisting && <div className="replace-warning">⚠ {replaceWarning}</div>}
        {importing && <div className="import-progress"><div><strong>Importing…</strong><span>{Math.round(progress)}%</span></div><progress value={progress} max={100}/></div>}
      </div>
      <footer><button className="button secondary" onClick={onCancel} disabled={importing}>Cancel</button><button className="button primary" disabled={!canImport} onClick={onImport}>{importing ? "Importing…" : "Import"}</button></footer>
    </section>
  </div>;
}
