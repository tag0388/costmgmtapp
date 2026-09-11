"use client";

import * as XLSX from "xlsx";

export type ExcelCell = string;
export type ExcelRow = Record<string, ExcelCell>;

export type ExcelColumn = {
  key: string;
  label: string;
  width?: number;
};

export async function readExcelFile(file: File): Promise<ExcelRow[]> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: false, cellText: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("The workbook does not contain a worksheet.");
  const worksheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(worksheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (!matrix.length) return [];
  const headers = matrix[0].map((value) => String(value ?? "").trim());
  return matrix.slice(1).map((row) => {
    const result: ExcelRow = {};
    headers.forEach((header, index) => {
      if (header) result[header] = String(row[index] ?? "").trim();
    });
    return result;
  }).filter((row) => Object.values(row).some((value) => value !== ""));
}

export function exportExcel(filename: string, sheetName: string, columns: ExcelColumn[], rows: ExcelRow[]) {
  const data = [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => row[column.key] ?? "")),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  worksheet["!cols"] = columns.map((column) => ({ wch: column.width ?? Math.max(12, column.label.length + 2) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheetName));
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`, { compression: true });
}

function safeSheetName(value: string) {
  return value.replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || "Data";
}
