import { formatCurrency, formatDate } from "@/lib/format";

/** Bir gelir kaydı ve ondan harcanan tutar (get_income_allocations). */
export type IncomeAllocation = {
  id: number;
  date: string;
  description: string;
  categoryId: number | null;
  amount: number;
  /** Bu gelire bağlı tüm giderlerin toplamı (giderin tarihi dönem dışında olsa da sayılır) */
  spent: number;
  expenseCount: number;
};

/** Gider formundaki "hangi gelirden?" seçeneği. */
export type IncomeSource = { id: number; label: string; remaining: number };

export const remainingOf = (a: { amount: number; spent: number }) => Math.round((a.amount - a.spent) * 100) / 100;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "Hakediş · 12.03.2026 · 1. hakediş" (listelerde ve rozetlerde kısa ad). */
export function incomeShortLabel(a: IncomeAllocation, catName: Map<number, string>): string {
  return `${a.categoryId === null ? "Kategorisiz" : (catName.get(a.categoryId) ?? "Kategori")} · ${formatDate(a.date)} · ${cut(a.description, 28)}`;
}

export function toIncomeSources(allocations: IncomeAllocation[], catName: Map<number, string>): IncomeSource[] {
  return allocations.map((a) => ({
    id: a.id,
    label: `${incomeShortLabel(a, catName)} · kalan ${formatCurrency(remainingOf(a))}`,
    remaining: remainingOf(a),
  }));
}
