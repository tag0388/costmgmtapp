"use client";

import * as XLSX from "xlsx";

export type ExcelRow = Record<string, string>;

export function exportExcel(filename: string, sheetName: string, rows: ExcelRow[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

export async function readExcel(file: File): Promise<ExcelRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? "").trim()])));
}
