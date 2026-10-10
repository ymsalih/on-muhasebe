/** Silme/arşiv kararının dayanağı olan veri sayaçlarının Türkçe adları (sunucu ve istemcide ortak). */
export const DATA_LABELS: Record<string, string> = {
  parties: "cari",
  goods_entries: "irsaliye/fatura kaydı",
  personnel: "personel",
  payment_accounts: "ödeme hesabı",
  attendance: "puantaj kaydı",
  transactions: "kasa hareketi",
  material_entries: "malzeme girişi",
  progress_payments: "hakediş",
  invoices: "fatura",
  machines: "makine",
  machine_attendance: "makine puantajı",
  fuel_entries: "yakıt kaydı",
  cheques: "çek",
  party_debts: "cari borç kaydı",
  company_entries: "şirket kasası kaydı",
};

/** {transactions: 12, personnel: 3} → "12 kasa hareketi, 3 personel" (sıfırlar atılır) */
export function describeCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${DATA_LABELS[k] ?? k}`)
    .join(", ");
}

export type DataSummary = { counts: Record<string, number>; total: number };
