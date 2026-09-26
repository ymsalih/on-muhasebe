import { PARTY_CATEGORY_LABELS } from "@/lib/goods/schemas";
import { formatDate } from "@/lib/format";
import { periodLabel } from "@/lib/reports/labels";
import { REPORT_TAB_LABELS, type ReportData } from "@/lib/reports/queries";

/** Excel ve PDF'in ortak, düz tablo biçimi. Sayılar ham tutulur; biçimlendirme dışa aktarma katmanındadır. */
export type ReportTable = {
  title: string;
  subtitle: string;
  headers: string[];
  /** Para biçimi uygulanacak sütun indeksleri */
  moneyCols: number[];
  /** Tam sayı (gün) sütunları */
  intCols: number[];
  rows: (string | number)[][];
  totals?: (string | number)[];
};

export function toTable(data: ReportData, siteName: string, from: string, to: string): ReportTable {
  const base = {
    title: `${siteName} — ${REPORT_TAB_LABELS[data.tab]}`,
    subtitle: `${formatDate(from)} – ${formatDate(to)}`,
    moneyCols: [] as number[],
    intCols: [] as number[],
  };

  switch (data.tab) {
    case "trend": {
      const active = data.points.filter((p) => p.income > 0 || p.expense > 0);
      return {
        ...base,
        headers: ["Dönem", "Gelir", "Gider", "Net"],
        moneyCols: [1, 2, 3],
        rows: active.map((p) => [data.bucket === "day" ? formatDate(p.period) : periodLabel(p.period, "month"), p.income, p.expense, p.income - p.expense]),
        totals: ["Toplam", data.income, data.expense, data.income - data.expense],
      };
    }
    case "kategori": {
      const pct = (v: number, total: number) => (total > 0 ? `%${Math.round((v / total) * 100)}` : "%0");
      return {
        ...base,
        headers: ["Tür", "Kategori", "Tutar", "Pay"],
        moneyCols: [2],
        rows: [
          ...data.income.map((r) => ["Gelir", r.name, r.total, pct(r.total, data.incomeTotal)]),
          ...data.expense.map((r) => ["Gider", r.name, r.total, pct(r.total, data.expenseTotal)]),
        ],
        totals: ["", "Net (gelir − gider)", data.incomeTotal - data.expenseTotal, ""],
      };
    }
    case "cari":
      return {
        ...base,
        headers: ["Cari", "Kategori", "Faturalanan", "Ödenen", "Tahsil edilen", "Kalan borç (tüm zamanlar)"],
        moneyCols: [2, 3, 4, 5],
        rows: data.rows.map((r) => [r.name, PARTY_CATEGORY_LABELS[r.category], r.invoiced, r.paid, r.collected, r.remaining]),
        totals: [
          "Toplam",
          "",
          data.rows.reduce((s, r) => s + r.invoiced, 0),
          data.rows.reduce((s, r) => s + r.paid, 0),
          data.rows.reduce((s, r) => s + r.collected, 0),
          data.rows.reduce((s, r) => s + r.remaining, 0),
        ],
      };
    case "personel":
      return {
        ...base,
        headers: ["Personel", "Çalıştığı gün", "Ödenen"],
        moneyCols: [2],
        intCols: [1],
        rows: data.rows.map((r) => [r.name, r.days, r.paid]),
        totals: ["Toplam", data.rows.reduce((s, r) => s + r.days, 0), data.rows.reduce((s, r) => s + r.paid, 0)],
      };
  }
}
