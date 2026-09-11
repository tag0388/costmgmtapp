export type ExcelRow = Record<string, string>;

export type ExcelColumn = {
  key: string;
  label: string;
};

export async function exportRowsToExcel(options: {
  filename: string;
  sheetName: string;
  columns: ExcelColumn[];
  rows: ExcelRow[];
}) {
  const XLSX = await import("@keep-lts/xlsx");
  const data = options.rows.map((row) => Object.fromEntries(options.columns.map((column) => [column.label, row[column.key] ?? ""])));
  const worksheet = XLSX.utils.json_to_sheet(data, { header: options.columns.map((column) => column.label) });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName.slice(0, 31));
  XLSX.writeFile(workbook, options.filename.endsWith(".xlsx") ? options.filename : `${options.filename}.xlsx`);
}

export async function parseExcelFile(file: File): Promise<ExcelRow[]> {
  const XLSX = await import("@keep-lts/xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const worksheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: false });
  return rows.map((row) => {
    const normalized: ExcelRow = {};
    for (const [key, value] of Object.entries(row)) normalized[String(key).trim()] = String(value ?? "").trim();
    return normalized;
  });
}
