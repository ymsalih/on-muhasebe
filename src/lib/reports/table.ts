import { PARTY_CATEGORY_LABELS } from "@/lib/goods/schemas";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { periodLabel } from "@/lib/reports/labels";
import { REPORT_TAB_LABELS, type ReportData } from "@/lib/reports/queries";

/** Excel ve PDF'in ortak, düz tablo biçimi. Sayılar ham tutulur; biçimlendirme dışa aktarma katmanındadır. */
export type ReportTable = {
  title: string;
  subtitle: string;
  /** Çok sayfalı Excel'de sayfa adı (en çok 31 karakter) */
  sheet?: string;
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

    case "ozet": {
      const x = data.n;
      const row = (group: string, item: string, value: string): (string | number)[] => [group, item, value];
      const money = formatCurrency;
      const num = formatNumber;
      return {
        ...base,
        headers: ["Başlık", "Kalem", "Değer"],
        rows: [
          row("Kasa", "Gelir", money(x.cashIncome)),
          row("Kasa", "Gider", money(x.cashExpense)),
          row("Kasa", "Net", money(x.cashIncome - x.cashExpense)),
          row("Kasa", "Hareket sayısı", num(x.cashCount)),
          row("Personel", "Puantaj (çalışılan gün toplamı)", num(x.attendanceDays)),
          row("Personel", "Çalışan kişi", num(x.attendancePeople)),
          row("Personel", "Ödenen maaş", money(x.wagePaid)),
          row("Personel", "Kayıtlı personel", num(x.personnelTotal)),
          row("İrsaliye / Fatura / Fiş", "Kayıt sayısı", num(x.goodsCount)),
          row("İrsaliye / Fatura / Fiş", "Tutar (fiyatı girilenler)", money(x.goodsTotal)),
          row("İrsaliye / Fatura / Fiş", "Nakliye", money(x.goodsTransport)),
          row("Malzeme", "Giriş sayısı", num(x.materialCount)),
          row("Malzeme", "Maliyet", money(x.materialTotal)),
          row("Yakıt", "Alım sayısı", num(x.fuelCount)),
          row("Yakıt", "Litre", num(x.fuelLiters)),
          row("Yakıt", "Tutar", money(x.fuelTotal)),
          row("Makine", "Çalışılan gün", num(x.machineDays)),
          row("Makine", "Çalışılan saat", num(x.machineHours)),
          row("Makine", "Ödenen kira", money(x.rentPaid)),
          row("Hakediş / Fatura", "Dönem hakediş", money(x.progressTotal)),
          row("Hakediş / Fatura", "Dönem fatura (KDV hariç)", money(x.invoiceTotal)),
          row("Hakediş / Fatura", "Dönem faturalardaki KDV", money(x.invoiceKdv)),
          row("Hakediş / Fatura", "Tüm zamanlar hakediş", money(x.progressAll)),
          row("Hakediş / Fatura", "Tüm zamanlar fatura", money(x.invoiceAll)),
          row("Hakediş / Fatura", "Kalan (hakediş − fatura)", money(x.progressAll - x.invoiceAll)),
          row("Cari", "Cari sayısı", num(x.partyCount)),
          row("Cari", "Borçlu cari sayısı", num(data.partyDebtCount)),
          row("Cari", "Toplam kalan borç", money(data.partyDebt)),
        ],
      };
    }
    case "malzeme": {
      const q = (v: number | null) => (v === null ? "" : v);
      const part = (label: string, rows: typeof data.partner) => rows.map((r) => [label, r.label, r.unit ?? "", r.count, q(r.quantity), r.total]);
      return {
        ...base,
        headers: ["Kırılım", "Ad", "Birim", "Giriş", "Miktar", "Maliyet"],
        moneyCols: [5],
        intCols: [3, 4],
        rows: [...part("Ortak", data.partner), ...part("Malzeme", data.item), ...part("Kullanım yeri", data.usage)],
        totals: ["", "Toplam malzeme maliyeti", "", data.count, "", data.total],
      };
    }
    case "yakit":
      return {
        ...base,
        headers: ["Ortak", "Araç", "Plaka / No", "Alım", "Litre", "Tutar", "Ort. litre fiyatı"],
        moneyCols: [5, 6],
        intCols: [3, 4],
        rows: data.rows.map((r) => [r.ownerName, r.machineName, r.identifier ?? "", r.count, r.liters, r.total, r.liters > 0 ? r.total / r.liters : 0]),
        totals: ["Toplam", "", "", data.count, data.liters, data.total, data.liters > 0 ? data.total / data.liters : 0],
      };
    case "makine":
      return {
        ...base,
        headers: ["Ortak", "Makine", "Plaka / No", "Sahiplik", "Çalışılan gün", "Saat", "Hesaplanan kira", "Ödenen kira", "Fark (hesaplanan − ödenen)"],
        moneyCols: [6, 7, 8],
        intCols: [4, 5],
        rows: data.rows.map((r) => [r.ownerName, r.name, r.identifier ?? "", r.ownership === "rented" ? "Kiralık" : "Kendi", r.days, r.hours, r.due, r.paid, r.due - r.paid]),
        totals: ["Toplam", "", "", "", data.days, data.hours, data.due, data.paid, data.due - data.paid],
      };
    case "hakedis": {
      const monthName = (iso: string) => periodLabel(iso, "month");
      return {
        ...base,
        headers: ["Ortak", "Dönem", "Hakediş", "Fatura (KDV hariç)", "Fatura KDV'si", "Fark (hakediş − fatura KDV hariç)"],
        moneyCols: [2, 3, 4, 5],
        rows: [
          ...data.months.map((r) => [r.ownerName, monthName(r.month), r.progress, r.invoices, r.kdv, r.progress - r.invoices]),
          ...data.owners.map((r) => [r.ownerName, "Tüm zamanlar (kalan)", r.progress, r.invoices, r.kdv, r.progress - r.invoices]),
        ],
        totals: ["Dönem toplamı", "", data.progress, data.invoices, data.kdv, data.progress - data.invoices],
      };
    }
  }
}
