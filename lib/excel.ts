import * as XLSX from "xlsx";

export type ExcelCellValue = string | number | boolean | null;
export type ExcelRow = Record<string, ExcelCellValue>;

export type ParsedExcel = {
  headers: string[];
  rows: Record<string, string>[];
};

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

export function exportExcel(filename: string, sheetName: string, rows: ExcelRow[], headers?: string[]) {
  const headerOrder = headers ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const normalizedRows = rows.map((row) => Object.fromEntries(headerOrder.map((header) => [header, row[header] ?? ""])));
  const worksheet = XLSX.utils.json_to_sheet(normalizedRows, { header: headerOrder, skipHeader: false });
  worksheet["!cols"] = headerOrder.map((header) => {
    const max = Math.max(header.length, ...normalizedRows.map((row) => String(row[header] ?? "").length));
    return { wch: Math.min(Math.max(max + 2, 12), 40) };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, `${safeFilename(filename)}.xlsx`, { compression: true });
}

export async function parseExcel(file: File): Promise<ParsedExcel> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("The workbook does not contain a worksheet.");
  const worksheet = workbook.Sheets[firstSheet];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (!matrix.length) throw new Error("The worksheet is empty.");
  const headers = matrix[0].map((value) => String(value).trim());
  if (!headers.some(Boolean)) throw new Error("The worksheet header row is empty.");
  const rows = matrix.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) row[header] = String(values[index] ?? "").trim();
    });
    return row;
  }).filter((row) => Object.values(row).some((value) => value !== ""));
  return { headers, rows };
}

export function findHeader(headers: string[], expected: string) {
  const target = expected.trim().toLowerCase();
  return headers.find((header) => header.trim().toLowerCase() === target) ?? null;
}

export function downloadTemplate(filename: string, sheetName: string, headers: string[], sampleRows: ExcelRow[] = []) {
  exportExcel(filename, sheetName, sampleRows.length ? sampleRows : [Object.fromEntries(headers.map((header) => [header, ""]))], headers);
}
