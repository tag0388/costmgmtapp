"use client";

import { useMemo, useRef, useState } from "react";
import { ExcelColumn, ExcelRow, parseExcelFile } from "@/lib/excel";

export type ImportValidation = { row: number; message: string };

type Props = {
  title: string;
  description: string;
  columns: ExcelColumn[];
  uniqueKey?: string;
  replaceLabel?: string;
  validateRows: (rows: ExcelRow[]) => ImportValidation[];
  onImport: (rows: ExcelRow[], replaceExisting: boolean, setProgress: (value: number) => void) => Promise<void>;
  onClose: () => void;
  onImported: () => Promise<void> | void;
};

export default function ExcelImportDialog({ title, description, columns, uniqueKey, replaceLabel = "Delete Existing Data", validateRows, onImport, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ExcelRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importError, setImportError] = useState("");

  const validationErrors = useMemo(() => {
    const errors = [...validateRows(rows)];
    if (uniqueKey) {
      const seen = new Map<string, number>();
      rows.forEach((row, index) => {
        const value = (row[uniqueKey] ?? "").trim().toLowerCase();
        if (!value) return;
        const first = seen.get(value);
        if (first !== undefined) errors.push({ row: index + 2, message: `Duplicate ${uniqueKey}: “${row[uniqueKey]}” (also row ${first + 2}).` });
        else seen.set(value, index);
      });
    }
    return errors;
  }, [rows, uniqueKey, validateRows]);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    setImportError("");
    setRows([]);
    try {
      const parsed = await parseExcelFile(file);
      if (!parsed.length) {
        setParseError("The first worksheet does not contain any data rows.");
        return;
      }
      setRows(parsed);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "The Excel file could not be read.");
    }
  }

  async function performImport() {
    if (!rows.length || validationErrors.length) return;
    if (replaceExisting && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setConfirmReplace(false);
    setImporting(true);
    setImportError("");
    setProgress(2);
    try {
      await onImport(rows, replaceExisting, (value) => setProgress(Math.max(0, Math.min(100, value))));
      setProgress(100);
      await onImported();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return <div className="bulk-dialog-layer">
    <button className="bulk-dialog-scrim" aria-label="Close import window" onClick={importing ? undefined : onClose}/>
    <section className="bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="excel-import-title">
      <header><div><span>Excel Import</span><h2 id="excel-import-title">{title}</h2><p>{description}</p></div><button className="bulk-close" onClick={onClose} disabled={importing}>×</button></header>
      <div className="bulk-dialog-body">
        <div className="bulk-file-row"><input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" hidden onChange={(event) => void chooseFile(event.target.files?.[0])}/><button className="button secondary" onClick={() => fileRef.current?.click()} disabled={importing}>Choose Excel File</button><span>{fileName || "No file selected"}</span></div>
        {parseError && <div className="form-error">{parseError}</div>}
        {rows.length > 0 && <>
          <div className="bulk-summary"><strong>{rows.length} data row{rows.length === 1 ? "" : "s"} detected</strong><span>{validationErrors.length ? `${validationErrors.length} validation error${validationErrors.length === 1 ? "" : "s"} must be fixed before import.` : "Validation passed. Review the preview before importing."}</span></div>
          {validationErrors.length > 0 && <div className="bulk-errors"><strong>Import blocked</strong>{validationErrors.slice(0, 12).map((error, index) => <span key={`${error.row}-${index}`}>Row {error.row}: {error.message}</span>)}{validationErrors.length > 12 && <small>+{validationErrors.length - 12} more errors</small>}</div>}
          <div className="bulk-preview-wrap"><table className="bulk-preview"><thead><tr><th>#</th>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}><td>{index + 2}</td>{columns.map((column) => <td key={column.key}>{row[column.label] ?? row[column.key] ?? ""}</td>)}</tr>)}</tbody></table>{rows.length > 100 && <div className="bulk-preview-more">Previewing first 100 rows of {rows.length}.</div>}</div>
          <label className="bulk-replace"><input type="checkbox" checked={replaceExisting} onChange={(event) => { setReplaceExisting(event.target.checked); setConfirmReplace(false); }}/><span><strong>{replaceLabel}</strong><small>Replace mode removes existing rows that are not in the Excel file. Leave unticked to update matching IDs and add new rows.</small></span></label>
        </>}
        {confirmReplace && <div className="bulk-danger-confirm"><strong>Are you sure you want to replace?</strong><span>This will delete all existing data in this scope and can’t be undone.</span><div><button className="button secondary" onClick={() => setConfirmReplace(false)}>No, go back</button><button className="button danger" onClick={() => void performImport()}>Yes, replace and import</button></div></div>}
        {importing && <div className="bulk-progress"><div><span>Importing…</span><strong>{Math.round(progress)}%</strong></div><progress max={100} value={progress}/></div>}
        {importError && <div className="form-error">{importError}</div>}
      </div>
      <footer><button className="button secondary" onClick={onClose} disabled={importing}>Cancel</button><button className="button primary" disabled={!rows.length || validationErrors.length > 0 || importing || confirmReplace} onClick={() => void performImport()}>{importing ? "Importing…" : "Import"}</button></footer>
    </section>
  </div>;
}
