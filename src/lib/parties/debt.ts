/**
 * Cari borç hesabı (istemci ve sunucuda ortak, saf fonksiyonlar).
 *   Toplam borç = yazılan borç (party_debts) + faturalanan (irsaliye tutarları)
 *   Kalan borç  = toplam borç − ödenen (cariye yapılan giderler)
 * Her ödeme yapıldığında "ödenen" artar, kalan borç kendiliğinden düşer; bakiye hiçbir yere kaydedilmez.
 */
export type DebtInput = { total_invoiced: number; total_debt: number; total_expense: number };

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Cariye toplam borcumuz: yazılan borç + irsaliye tutarları. */
export const owedTotal = (b: Pick<DebtInput, "total_invoiced" | "total_debt">): number => round2(b.total_invoiced + b.total_debt);

/** Kalan borç; negatif = fazla ödeme. */
export const remainingDebt = (b: DebtInput): number => round2(owedTotal(b) - b.total_expense);
