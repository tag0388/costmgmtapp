"use client";

import * as XLSX from "xlsx";

export type ExcelRow = Record<string, string>;

export type ExcelSheetReader = {
  columns: string[];
  rowCount: number;
  preview: ExcelRow[];
  readRows: (start: number, count: number) => ExcelRow[];
};

export function exportExcel(filename: string, sheetName: string, rows: ExcelRow[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

function toIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeTwoDigitYear(year: number) {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function normalizeExcelDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return toIsoDate(parsed.y, parsed.m, parsed.d);
  }

  const text = String(value ?? "").trim();
  if (!text) return "";

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) ?? text;

  const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = normalizeTwoDigitYear(Number(numeric[3]));
    const [day, month] = first > 12 ? [first, second] : second > 12 ? [second, first] : [first, second];
    return toIsoDate(year, month, day) ?? text;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return toIsoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()) ?? text;
  }

  return text;
}

function normalizeExcelRow(row: Record<string, unknown>): ExcelRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const normalizedKey = key.trim();
    const isDateColumn = /(^|\s)date$/i.test(normalizedKey);
    const normalizedValue = isDateColumn ? normalizeExcelDate(value) : String(value ?? "").trim();
    return [normalizedKey, normalizedValue ?? String(value ?? "").trim()];
  }));
}

export async function openExcel(file: File, previewSize = 100): Promise<ExcelSheetReader> {
  const buffer = await file.arrayBuffer();
  // Dense worksheets use substantially less overhead for large, mostly-filled ledgers.
  // We still keep only one workbook plus the current converted chunk in memory.
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, dense: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { columns: [], rowCount: 0, preview: [], readRows: () => [] };
  const sheet = workbook.Sheets[sheetName];
  const reference = sheet["!ref"];
  if (!reference) return { columns: [], rowCount: 0, preview: [], readRows: () => [] };

  const range = XLSX.utils.decode_range(reference);
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
    range: { s: { r: range.s.r, c: range.s.c }, e: { r: range.s.r, c: range.e.c } },
  });
  const columns = (headerRows[0] ?? []).map((value) => String(value ?? "").trim());
  const firstDataRow = range.s.r + 1;
  const rowCount = Math.max(0, range.e.r - firstDataRow + 1);

  const readRows = (start: number, count: number) => {
    if (count <= 0 || start < 0 || start >= rowCount) return [];
    const startRow = firstDataRow + start;
    const endRow = Math.min(range.e.r, startRow + count - 1);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      header: columns,
      defval: "",
      raw: true,
      range: { s: { r: startRow, c: range.s.c }, e: { r: endRow, c: range.e.c } },
    });
    return rows.map(normalizeExcelRow);
  };

  return {
    columns,
    rowCount,
    preview: readRows(0, previewSize),
    readRows,
  };
}

export async function readExcel(file: File): Promise<ExcelRow[]> {
  const reader = await openExcel(file, 0);
  return reader.readRows(0, reader.rowCount);
}
