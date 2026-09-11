"use client";

export type ExcelRow = Record<string, string>;

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function encode(text: string) { return new TextEncoder().encode(text); }

function columnName(index: number) {
  let result = "";
  let n = index + 1;
  while (n > 0) { n -= 1; result = String.fromCharCode(65 + (n % 26)) + result; n = Math.floor(n / 26); }
  return result;
}

function worksheetXml(headers: string[], rows: ExcelRow[]) {
  const allRows = [
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? "")),
  ];
  const rowXml = allRows.map((values, rowIndex) => {
    const cells = values.map((value, colIndex) => `<c r="${columnName(colIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function createZip(entries: Array<{ name: string; content: string }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encode(entry.name);
    const data = encode(entry.content);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    localParts.push(local);
    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }
  const central = concat(centralParts);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0)]);
  return concat([...localParts, central, end]);
}

export function exportExcel(filename: string, sheetName: string, headers: string[], rows: ExcelRow[]) {
  const entries = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName.slice(0, 31) || "Sheet1")}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(headers, rows) },
  ];
  const blob = new Blob([createZip(entries)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readU16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function readU32(view: DataView, offset: number) { return view.getUint32(offset, true); }

async function unzipEntry(buffer: ArrayBuffer, nameWanted: string) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (readU32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("The Excel file is not a valid .xlsx file.");
  const centralOffset = readU32(view, eocd + 16);
  const total = readU16(view, eocd + 10);
  let ptr = centralOffset;
  for (let index = 0; index < total; index += 1) {
    if (readU32(view, ptr) !== 0x02014b50) break;
    const method = readU16(view, ptr + 10);
    const compressedSize = readU32(view, ptr + 20);
    const fileNameLength = readU16(view, ptr + 28);
    const extraLength = readU16(view, ptr + 30);
    const commentLength = readU16(view, ptr + 32);
    const localOffset = readU32(view, ptr + 42);
    const name = new TextDecoder().decode(bytes.slice(ptr + 46, ptr + 46 + fileNameLength));
    if (name === nameWanted) {
      const localNameLength = readU16(view, localOffset + 26);
      const localExtraLength = readU16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      if (method === 0) return new TextDecoder().decode(compressed);
      if (method === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new TextDecoder().decode(await new Response(stream).arrayBuffer());
      }
      throw new Error(`Unsupported Excel compression method: ${method}`);
    }
    ptr += 46 + fileNameLength + extraLength + commentLength;
  }
  return null;
}

function parseSharedStrings(xml: string | null) {
  if (!xml) return [] as string[];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagNameNS("*", "si")).map((si) => Array.from(si.getElementsByTagNameNS("*", "t")).map((node) => node.textContent ?? "").join(""));
}

export async function importExcel(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Please select an .xlsx Excel file.");
  const buffer = await file.arrayBuffer();
  const [sheetXml, sharedXml] = await Promise.all([
    unzipEntry(buffer, "xl/worksheets/sheet1.xml"),
    unzipEntry(buffer, "xl/sharedStrings.xml"),
  ]);
  if (!sheetXml) throw new Error("The Excel file does not contain a readable first worksheet.");
  const shared = parseSharedStrings(sharedXml);
  const doc = new DOMParser().parseFromString(sheetXml, "application/xml");
  const rows = Array.from(doc.getElementsByTagNameNS("*", "row")).map((row) => {
    const values: string[] = [];
    for (const cell of Array.from(row.getElementsByTagNameNS("*", "c"))) {
      const ref = cell.getAttribute("r") ?? "A1";
      const letters = ref.replace(/\d/g, "");
      let col = 0;
      for (const letter of letters) col = col * 26 + (letter.charCodeAt(0) - 64);
      col -= 1;
      const type = cell.getAttribute("t");
      let value = "";
      if (type === "inlineStr") value = Array.from(cell.getElementsByTagNameNS("*", "t")).map((node) => node.textContent ?? "").join("");
      else {
        const raw = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
        value = type === "s" ? (shared[Number(raw)] ?? "") : raw;
      }
      values[col] = value;
    }
    return values;
  });
  if (rows.length === 0) return { headers: [] as string[], rows: [] as ExcelRow[] };
  const headers = rows[0].map((value) => String(value ?? "").trim());
  const data = rows.slice(1).filter((row) => row.some((value) => String(value ?? "").trim() !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])) as ExcelRow);
  return { headers, rows: data };
}
