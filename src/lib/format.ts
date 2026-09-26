/** Tüm uygulamada tek biçimlendirme noktası (CLAUDE.md 7.1): tarih GG.AA.YYYY, para ₺12.500,00. */

const currencyFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

const numberFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });

/** Miktar gibi para olmayan sayılar: 1.250,5 */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** "YYYY-MM-DD" (DATE sütunu) veya ISO zaman damgası kabul eder; saat dilimi kayması olmaz. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return `${match[3]}.${match[2]}.${match[1]}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}
