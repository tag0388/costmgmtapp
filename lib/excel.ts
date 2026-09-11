"use client";

export type ExcelCell = string | number | boolean | null | undefined;
export type ExcelRow = Record<string, ExcelCell>;
export type ExcelSheet = { name: string; rows: ExcelRow[] };

type XlsxSheet = unknown;
type XlsxWorkbook = { SheetNames: string[]; Sheets: Record<string, XlsxSheet> };
type XlsxApi = {
  read: (data: ArrayBuffer, options?: Record<string, unknown>) => XlsxWorkbook;
  writeFile: (workbook: XlsxWorkbook, filename: string, options?: Record<string, unknown>) => void;
  utils: {
    book_new: () => XlsxWorkbook;
    book_append_sheet: (workbook: XlsxWorkbook, sheet: XlsxSheet, name: string) => void;
    json_to_sheet: (rows: ExcelRow[], options?: Record<string, unknown>) => XlsxSheet;
    sheet_to_json: <T>(sheet: XlsxSheet, options?: Record<string, unknown>) => T[];
  };
};

declare global {
  interface Window { XLSX?: XlsxApi }
}

const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
let loadingPromise: Promise<XlsxApi> | null = null;

export function loadExcelEngine(): Promise<XlsxApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("Excel tools are only available in the browser."));
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<XlsxApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SHEETJS_URL}"]`);
    const script = existing ?? document.createElement("script");
    const finish = () => window.XLSX ? resolve(window.XLSX) : reject(new Error("Excel engine loaded but was unavailable."));
    const fail = () => reject(new Error("Unable to load the Excel engine. Check your network connection and try again."));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = SHEETJS_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
  }).finally(() => { loadingPromise = null; });

  return loadingPromise;
}

export async function exportExcel(filename: string, sheets: ExcelSheet[]) {
  const XLSX = await loadExcelEngine();
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows, { skipHeader: false });
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheet.name));
  }
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`, { compression: true });
}

export async function readExcel(file: File, sheetIndex = 0): Promise<Record<string, string>[]> {
  const XLSX = await loadExcelEngine();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: false });
  const sheetName = workbook.SheetNames[sheetIndex];
  if (!sheetName) throw new Error("The workbook does not contain a worksheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, ExcelCell>>(workbook.Sheets[sheetName], { defval: "", raw: false });
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [String(key).trim(), cellText(value)])));
}

export function cellText(value: ExcelCell) {
  return value == null ? "" : String(value).trim();
}

function safeSheetName(name: string) {
  return name.replace(/[\\/?*:[\]]/g, " ").trim().slice(0, 31) || "Data";
}
