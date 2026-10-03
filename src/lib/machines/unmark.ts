import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import type { RateUnit } from "@/lib/machines/schemas";

/** Bir makinenin o ayki kira ödemeleri (günlük ekran ve matriste işaret değişimi onayı için). */
export type PaidInfo = {
  count: number;
  amount: number;
  /** Ödemeler puantaja BAĞLI mı (ay tam ödenmiş)? Bağlıysa puantaj değişince ödeme otomatik güncellenir. */
  synced: boolean;
  unit: RateUnit;
  /** Bağlı ödemeler, en yeniden eskiye: veritabanı tetikleyicisiyle aynı sırada uygulanır */
  payments: { qty: number; rate: number }[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const noun = (u: RateUnit) => (u === "day" ? "gün" : "saat");

/**
 * Puantaj `delta` (gün ya da saat) değişince bağlı ödemelerin ne olacağını hesaplar. Veritabanı tetikleyicisiyle (private.sync_machine_rental)
 * AYNI kural: artış/azalış en yeni ödemeye uygulanır; bir ödemenin tamamı çıkarsa silinir, kalan azalış bir öncekine geçer.
 */
export function simulateSync(payments: PaidInfo["payments"], delta: number) {
  let remaining = delta;
  const next = payments.map((p) => ({ ...p }));
  let removed = 0;
  for (let i = 0; i < next.length && remaining !== 0; i++) {
    const q = round1(next[i].qty + remaining);
    if (q > 0) {
      next[i].qty = q;
      remaining = 0;
    } else {
      remaining = q;
      next[i].qty = 0;
      removed += 1;
    }
  }
  const sum = (list: PaidInfo["payments"]) => ({ qty: round1(list.reduce((s, p) => s + p.qty, 0)), amount: round2(list.reduce((s, p) => s + round2(p.qty * p.rate), 0)) });
  return { before: sum(payments), after: sum(next.filter((p) => p.qty > 0)), removed };
}

function syncLine(paid: PaidInfo, delta: number, verb: string): string | null {
  if (!paid.synced || delta === 0) return null;
  const { before, after, removed } = simulateSync(paid.payments, delta);
  if (before.qty === after.qty) return null;
  return (
    `Bu ay kira ödemesi tam yapılmış ve puantaja bağlı: ${verb} ödeme de otomatik güncellenir — ` +
    `${formatNumber(before.qty)} ${noun(paid.unit)} → ${formatNumber(after.qty)} ${noun(paid.unit)} (${formatCurrency(before.amount)} → ${formatCurrency(after.amount)})` +
    `${removed > 0 ? `; kasadaki ${removed} ödeme kaydı silinir` : ""}.`
  );
}

/**
 * İşareti KALDIRMADAN önce sorulacak onay metni. Boş dönerse sormaya gerek yoktur (saat/not yok ve ödeme yok).
 * İşareti kaldırmak o günün saat ve notunu da siler; ay tam ödenmişse ödeme de otomatik güncellenir (Tekrar işaretlerseniz eski haline döner).
 */
export function unmarkConfirmText(name: string, iso: string, entry: { hours: number | null; note: string | null }, paid?: PaidInfo): string | null {
  const hasData = entry.hours != null || !!entry.note;
  if (!hasData && !paid) return null;
  const parts = [`“${name}” makinesinin ${formatDate(iso)} günlük işareti kaldırılsın mı?`];
  if (hasData) parts.push("O güne girilen saat/not da silinir (Geri al ile geri getirebilirsiniz).");
  if (paid) {
    const delta = paid.unit === "day" ? -1 : -(entry.hours ?? 0);
    const sync = syncLine(paid, delta, "işareti kaldırırsanız");
    parts.push(
      sync ??
        `Bu makine için bu ay ${paid.count} kira ödemesi yapılmış (${formatCurrency(paid.amount)}). Ödeme puantaja bağlı değil (kısmi ödeme), kasadaki kayıt kendiliğinden değişmez; fark “kalan/fazla” olarak görünür.`,
    );
    if (sync) parts.push("Geri al derseniz ödeme de eski haline döner.");
  }
  return parts.join("\n\n");
}

/** Günü İŞARETLEMEDEN önce: ay tam ödenmişse (gün bazlı kira) ödeme de artacağı için sorulur. Yoksa null. */
export function markConfirmText(name: string, iso: string, paid?: PaidInfo): string | null {
  if (!paid || paid.unit !== "day") return null;
  const sync = syncLine(paid, 1, "bu günü işaretlerseniz");
  return sync ? [`“${name}” makinesi ${formatDate(iso)} günü için işaretlensin mi?`, sync, "Bu gün ödenmediyse, işaretledikten sonra kasadaki ödeme kaydını düzenleyebilirsiniz."].join("\n\n") : null;
}

/** Saatlik kirada saat DEĞİŞİNCE (ay tam ödenmişse ödeme de güncelleneceği için) sorulur. Yoksa null. */
export function hoursConfirmText(name: string, iso: string, oldHours: number | null, newHours: number | null, paid?: PaidInfo): string | null {
  if (!paid || paid.unit !== "hour") return null;
  const sync = syncLine(paid, (newHours ?? 0) - (oldHours ?? 0), "saati değiştirirseniz");
  return sync ? [`“${name}” ${formatDate(iso)} günü çalışma saati değiştirilsin mi?`, sync].join("\n\n") : null;
}
