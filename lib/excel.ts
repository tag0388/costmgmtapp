"use client";

import * as XLSX from "xlsx";

export type ExcelRow = Record<string, string>;
export type ExcelColumn = { key: string; header: string; width?: number };

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

export function exportExcel(filename: string, sheetName: string, columns: ExcelColumn[], rows: ExcelRow[]) {
  const data = rows.map((row) => {
    const result: Record<string, string> = {};
    for (const column of columns) result[column.header] = row[column.key] ?? "";
    return result;
  });
  const worksheet = XLSX.utils.json_to_sheet(data, { header: columns.map((column) => column.header) });
  worksheet["!cols"] = columns.map((column) => ({ wch: column.width ?? Math.max(12, Math.min(32, column.header.length + 4)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${safeFileName(filename)}.xlsx`, { compression: true });
}

export async function readExcel(file: File): Promise<ExcelRow[]> {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The workbook does not contain a worksheet.");
  const worksheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: false, blankrows: false });
  return raw.map((row) => {
    const normalized: ExcelRow = {};
    for (const [key, value] of Object.entries(row)) normalized[String(key).trim()] = String(value ?? "").trim();
    return normalized;
  }).filter((row) => Object.values(row).some((value) => value !== ""));
}

export function valueFromHeaders(row: ExcelRow, ...headers: string[]) {
  const lookup = new Map(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const header of headers) {
    const value = lookup.get(header.trim().toLowerCase());
    if (value !== undefined) return value;
  }
  return "";
}
