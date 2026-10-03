import { formatDate } from "@/lib/format";
import type { MaterialSummaryRow, MovementRow } from "@/lib/materials/queries";
import type { ReportTable } from "@/lib/reports/table";

const label = (name: string, variant: string | null) => (variant ? `${name} · ${variant}` : name);

/** Stok durumu tablosu (Excel/PDF ortak biçimi). */
export function stockTable(siteName: string, from: string, to: string, rows: MaterialSummaryRow[]): ReportTable {
  return {
    title: `${siteName} — Malzeme Stok Durumu`,
    subtitle: `Stok şu anki durumdur; giriş/çıkış tutarları ${formatDate(from)} – ${formatDate(to)} dönemine aittir`,
    headers: ["Malzeme", "Birim", "Eldeki stok", "Ortalama alış fiyatı", "Stok değeri", "Dönem giriş tutarı", "Dönem çıkış tutarı"],
    moneyCols: [3, 4, 5, 6],
    intCols: [2],
    rows: rows.map((r) => [label(r.name, r.variant), r.unit, r.stockQty, r.avgCost, r.stockValue, r.periodInAmount, r.periodOutAmount]),
    totals: [
      "Toplam",
      "",
      "",
      "",
      rows.reduce((s, r) => s + r.stockValue, 0),
      rows.reduce((s, r) => s + r.periodInAmount, 0),
      rows.reduce((s, r) => s + r.periodOutAmount, 0),
    ],
  };
}

/** Çıkış raporu: verilen malzemeler. Tutar = miktar × malzemenin ortalama alış fiyatı. */
export function outflowTable(siteName: string, from: string, to: string, movements: MovementRow[], summary: MaterialSummaryRow[]): ReportTable {
  const avg = new Map(summary.map((m) => [m.id, m.avgCost]));
  const rows = movements.map((r) => {
    const value = Math.round(r.quantity * (avg.get(r.materialId) ?? 0) * 100) / 100;
    return [formatDate(r.date), r.material ? label(r.material.name, r.material.variant) : "Silinmiş malzeme", r.quantity, r.material?.unit ?? "", r.counterparty ?? "", value, r.note ?? ""];
  });
  return {
    title: `${siteName} — Malzeme Çıkış Raporu`,
    subtitle: `${formatDate(from)} – ${formatDate(to)} · tutar = miktar × ortalama alış fiyatı`,
    headers: ["Tarih", "Malzeme", "Miktar", "Birim", "Kime verildi", "Tutar", "Not"],
    moneyCols: [5],
    intCols: [2],
    rows,
    totals: ["Toplam", "", "", "", "", rows.reduce((s, r) => s + (r[5] as number), 0), ""],
  };
}
