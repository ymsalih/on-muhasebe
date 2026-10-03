import { formatDate } from "@/lib/format";
import type { BreakdownRow, EntryRow } from "@/lib/materials/queries";
import type { Breakdown } from "@/lib/materials/schemas";
import type { ReportTable } from "@/lib/reports/table";

const BREAKDOWN_TITLES: Record<Breakdown, { title: string; head: string }> = {
  partner: { title: "Ortak Bazında Malzeme Maliyeti", head: "Ortak (giren)" },
  item: { title: "Malzeme Bazında Maliyet", head: "Malzeme" },
  usage: { title: "Kullanım Yerine Göre Malzeme Maliyeti", head: "Kullanım yeri" },
};

/** Malzeme girişleri (Excel/PDF ortak biçimi). */
export function entriesTable(siteName: string, from: string, to: string, rows: EntryRow[]): ReportTable {
  return {
    title: `${siteName} — Malzeme Girişleri`,
    subtitle: `${formatDate(from)} – ${formatDate(to)} · maliyet = miktar × birim fiyat`,
    headers: ["Tarih", "Malzeme", "Miktar", "Birim", "Birim fiyat", "Maliyet", "Kimden", "Kullanım yeri", "Giren"],
    moneyCols: [4, 5],
    intCols: [2],
    rows: rows.map((r) => [formatDate(r.date), r.variant ? `${r.name} · ${r.variant}` : r.name, r.quantity, r.unit, r.unitPrice, r.total, r.supplier ?? "", r.usedFor ?? "", r.enteredBy ?? ""]),
    totals: ["Toplam", "", "", "", "", rows.reduce((s, r) => s + r.total, 0), "", "", ""],
  };
}

/** Maliyet kırılımı tablosu (ortak / malzeme / kullanım yeri). */
export function breakdownTable(siteName: string, from: string, to: string, by: Breakdown, rows: BreakdownRow[]): ReportTable {
  const withQty = by === "item";
  const { title, head } = BREAKDOWN_TITLES[by];
  const total = rows.reduce((s, r) => s + r.total, 0);
  const pct = (v: number) => (total > 0 ? `%${Math.round((v / total) * 100)}` : "%0");
  return {
    title: `${siteName} — ${title}`,
    subtitle: `${formatDate(from)} – ${formatDate(to)}`,
    headers: withQty ? [head, "Giriş sayısı", "Toplam miktar", "Birim", "Maliyet", "Pay"] : [head, "Giriş sayısı", "Maliyet", "Pay"],
    moneyCols: withQty ? [4] : [2],
    intCols: withQty ? [1, 2] : [1],
    rows: rows.map((r) => (withQty ? [r.label, r.count, r.quantity ?? 0, r.unit ?? "", r.total, pct(r.total)] : [r.label, r.count, r.total, pct(r.total)])),
    totals: withQty ? ["Toplam", rows.reduce((s, r) => s + r.count, 0), "", "", total, ""] : ["Toplam", rows.reduce((s, r) => s + r.count, 0), total, ""],
  };
}
