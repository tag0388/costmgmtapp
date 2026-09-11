export type ExcelCell = string | number | boolean | null | undefined;
export type ExcelRow = Record<string, ExcelCell>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xml(value: ExcelCell) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function colName(index: number) {
  let value = index + 1;
  let result = "";
  while (value) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function uint16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

type ZipEntry = { name: string; data: Uint8Array };

function zipStore(entries: ZipEntry[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | (Math.floor(now.getSeconds() / 2) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = concat([
      uint32(0x04034b50), uint16(20), uint16(0), uint16(0), uint16(dosTime), uint16(dosDate),
      uint32(crc), uint32(entry.data.length), uint32(entry.data.length), uint16(name.length), uint16(0), name, entry.data,
    ]);
    localParts.push(local);
    const central = concat([
      uint32(0x02014b50), uint16(20), uint16(20), uint16(0), uint16(0), uint16(dosTime), uint16(dosDate),
      uint32(crc), uint32(entry.data.length), uint32(entry.data.length), uint16(name.length), uint16(0), uint16(0),
      uint16(0), uint16(0), uint32(0), uint32(offset), name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }
  const central = concat(centralParts);
  const end = concat([uint32(0x06054b50), uint16(0), uint16(0), uint16(entries.length), uint16(entries.length), uint32(central.length), uint32(offset), uint16(0)]);
  return concat([...localParts, central, end]);
}

export function exportExcel(filename: string, sheetName: string, headers: string[], rows: ExcelRow[]) {
  const allRows = [headers.map((header) => header), ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
  const sheetRows = allRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, colIndex) => `<c r="${colName(colIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join("")}</row>`).join("");
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: "_rels/.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: encoder.encode(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheetXml) },
  ];
  const blob = new Blob([zipStore(entries)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

function findEnd(bytes: Uint8Array) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65558); offset--) {
    if (new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true) === 0x06054b50) return offset;
  }
  throw new Error("The selected file is not a valid Excel .xlsx file.");
}

async function inflateRaw(data: Uint8Array) {
  if (!("DecompressionStream" in window)) throw new Error("This browser cannot read compressed Excel files. Please use a current version of Chrome or Edge.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(bytes: Uint8Array) {
  const endOffset = findEnd(bytes);
  const end = new DataView(bytes.buffer, bytes.byteOffset + endOffset);
  const count = end.getUint16(10, true);
  let offset = end.getUint32(16, true);
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index++) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    if (view.getUint32(0, true) !== 0x02014b50) throw new Error("Excel ZIP directory is invalid.");
    const method = view.getUint16(10, true);
    const compressedSize = view.getUint32(20, true);
    const nameLength = view.getUint16(28, true);
    const extraLength = view.getUint16(30, true);
    const commentLength = view.getUint16(32, true);
    const localOffset = view.getUint32(42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const local = new DataView(bytes.buffer, bytes.byteOffset + localOffset);
    const localNameLength = local.getUint16(26, true);
    const localExtraLength = local.getUint16(28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    files.set(name, method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : (() => { throw new Error(`Unsupported Excel compression method ${method}.`); })());
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function cellColumn(reference: string) {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

export async function importExcel(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Please select an Excel .xlsx file.");
  const files = await unzip(new Uint8Array(await file.arrayBuffer()));
  const sheetName = [...files.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!sheetName) throw new Error("No worksheet was found in the Excel file.");
  const shared = files.get("xl/sharedStrings.xml");
  const sharedStrings = shared ? [...new DOMParser().parseFromString(decoder.decode(shared), "application/xml").getElementsByTagName("si")].map((node) => node.textContent ?? "") : [];
  const documentXml = new DOMParser().parseFromString(decoder.decode(files.get(sheetName)!), "application/xml");
  const rows = [...documentXml.getElementsByTagName("row")].map((row) => {
    const values: string[] = [];
    for (const cell of [...row.getElementsByTagName("c")]) {
      const column = cellColumn(cell.getAttribute("r") ?? "A1");
      const type = cell.getAttribute("t");
      const raw = type === "inlineStr" ? cell.getElementsByTagName("t")[0]?.textContent ?? "" : cell.getElementsByTagName("v")[0]?.textContent ?? "";
      values[column] = type === "s" ? sharedStrings[Number(raw)] ?? "" : raw;
    }
    return values;
  });
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((value) => String(value ?? "").trim());
  const data = rows.slice(1).filter((row) => row.some((value) => String(value ?? "").trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])));
  return { headers, rows: data };
}
