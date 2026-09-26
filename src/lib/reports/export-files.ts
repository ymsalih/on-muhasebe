import "server-only";
import path from "node:path";
import ExcelJS from "exceljs";
import * as pdfMakeNs from "pdfmake";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { ReportTable } from "@/lib/reports/table";

/** Excel: başlık + dönem, kalın başlık satırı, para sütunları ₺ biçiminde (sayı olarak kalır, toplanabilir). */
export async function toXlsx(table: ReportTable, sheetName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));

  ws.addRow([table.title]).font = { bold: true, size: 14 };
  ws.addRow([table.subtitle]).font = { color: { argb: "FF666666" } };
  ws.addRow([]);
  const header = ws.addRow(table.headers);
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
  });

  for (const r of table.rows) ws.addRow(r);
  if (table.totals) {
    const t = ws.addRow(table.totals);
    t.font = { bold: true };
  }

  const money = '#,##0.00 "₺"';
  table.moneyCols.forEach((i) => {
    ws.getColumn(i + 1).numFmt = money;
    ws.getColumn(i + 1).alignment = { horizontal: "right" };
  });
  table.intCols.forEach((i) => (ws.getColumn(i + 1).alignment = { horizontal: "right" }));
  table.headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...table.rows.map((r) => String(r[i] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(48, Math.max(12, longest + 4));
  });
  ws.getRow(4).height = 20;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

const FONT_DIR = path.join(process.cwd(), "node_modules", "pdfmake", "build", "fonts", "Roboto");

// pdfmake CommonJS bir örnek dışa aktarır; ES import biçimine göre `default` altında olabilir.
const pdfmake = ((pdfMakeNs as unknown as { default?: typeof pdfMakeNs }).default ?? pdfMakeNs) as typeof pdfMakeNs;
pdfmake.setFonts({
  // Roboto Türkçe karakterleri (ş ğ ı İ ö ü ç) içerir; standart PDF yazı tipleri içermez.
  Roboto: {
    normal: path.join(FONT_DIR, "Roboto-Regular.ttf"),
    bold: path.join(FONT_DIR, "Roboto-Medium.ttf"),
    italics: path.join(FONT_DIR, "Roboto-Italic.ttf"),
    bolditalics: path.join(FONT_DIR, "Roboto-MediumItalic.ttf"),
  },
});
// Yalnızca yazı tipi klasöründen yerel dosya okunabilir.
pdfmake.setLocalAccessPolicy((p) => path.resolve(p).startsWith(FONT_DIR));

/** PDF: A4, sayı sütunları sağa yaslı, para ₺12.500,00 biçiminde. Sütun sayısı fazlaysa yatay sayfa. */
export async function toPdf(table: ReportTable): Promise<Buffer> {
  const fmt = (v: string | number, col: number) =>
    typeof v === "number" ? (table.moneyCols.includes(col) ? formatCurrency(v) : formatNumber(v)) : v;
  const numeric = new Set([...table.moneyCols, ...table.intCols]);

  const headerRow = table.headers.map((h, i) => ({
    text: h,
    bold: true,
    fillColor: "#E8EEF4",
    alignment: numeric.has(i) ? ("right" as const) : ("left" as const),
  }));
  const bodyRows = table.rows.map((r) => r.map((v, i) => ({ text: fmt(v, i), alignment: numeric.has(i) ? ("right" as const) : ("left" as const) })));
  if (table.totals) {
    bodyRows.push(table.totals.map((v, i) => ({ text: fmt(v, i), bold: true, alignment: numeric.has(i) ? ("right" as const) : ("left" as const) })));
  }

  const doc = pdfmake.createPdf({
    pageSize: "A4",
    pageOrientation: table.headers.length > 4 ? "landscape" : "portrait",
    pageMargins: [36, 40, 36, 40],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    content: [
      { text: table.title, fontSize: 15, bold: true, margin: [0, 0, 0, 2] },
      { text: table.subtitle, color: "#666666", margin: [0, 0, 0, 10] },
      table.rows.length === 0
        ? { text: "Bu dönemde kayıt yok.", italics: true }
        : {
            table: { headerRows: 1, widths: table.headers.map((_, i) => (i === 0 || (!numeric.has(i) && table.headers.length > 3) ? "*" : "auto")), body: [headerRow, ...bodyRows] },
            layout: "lightHorizontalLines",
          },
    ],
    footer: (page: number, pages: number) => ({ text: `${page} / ${pages}`, alignment: "center", fontSize: 8, color: "#888888", margin: [0, 10, 0, 0] }),
  });
  return Buffer.from(await doc.getBuffer());
}
