import { formatCurrency, formatDate } from "@/lib/format";

/** O ay bir makine için yapılmış kira ödemeleri (günlük ekran ve matriste işaret kaldırma onayı için). */
export type PaidInfo = { count: number; amount: number };

/**
 * İşareti kaldırmadan önce sorulacak onay metni. Boş dönerse sormaya gerek yoktur (saat/not yok ve ödeme yok).
 * İşareti kaldırmak o günün saat ve notunu da siler; kira ödemesi yapılmışsa hesaplanan kira düşer ve ödeme fazla görünür.
 */
export function unmarkConfirmText(name: string, iso: string, entry: { hours: number | null; note: string | null }, paid?: PaidInfo): string | null {
  const hasData = entry.hours != null || !!entry.note;
  if (!hasData && !paid) return null;
  const parts = [`“${name}” makinesinin ${formatDate(iso)} günlük işareti kaldırılsın mı?`];
  if (hasData) parts.push("O güne girilen saat/not da silinir (Geri al ile geri getirebilirsiniz).");
  if (paid) {
    parts.push(
      `Bu makine için bu ay ${paid.count} kira ödemesi yapılmış (${formatCurrency(paid.amount)}). İşareti kaldırırsanız hesaplanan kira düşer ve ödeme “fazla” görünür; kasadaki ödeme kaydı kendiliğinden değişmez.`,
    );
  }
  return parts.join("\n\n");
}
