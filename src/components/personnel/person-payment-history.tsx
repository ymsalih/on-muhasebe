import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { monthLabel } from "@/lib/personnel/payment-schemas";
import type { PersonPayment } from "@/lib/personnel/payments";

/**
 * Personelin maaş ödemesi GEÇMİŞİ (salt okunur). Maaş ödemesi artık Puantaj → Maaş Ödemeleri sayfasından yapılır:
 * orada o ayın gün sayısı ve günlük ücret otomatik gelir ve ödemenin hangi gelirden yapıldığı seçilir.
 */
export function PersonPaymentHistory({ siteId, payments }: { siteId: number; payments: PersonPayment[] }) {
  const total = payments.reduce((s, p) => s + p.amount, 0);
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Maaş ödemeleri">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Maaş Ödemeleri</h2>
          {payments.length > 0 && <p className="text-xs text-muted-foreground">Toplam ödenen: {formatCurrency(total)}</p>}
        </div>
        <Link href={`/sites/${siteId}/puantaj?gorunum=maas`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          Puantajdan öde
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz maaş ödemesi yok. Ödemeler Puantaj sayfasındaki “Maaş Ödemeleri” sekmesinden yapılır.</p>
      ) : (
        <ul className="divide-y">
          {payments.map((p) => (
            <li key={p.id} className="flex min-h-14 items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.period_month ? monthLabel(p.period_month.slice(0, 7)) : p.description}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatDate(p.transaction_date)}
                  {p.work_days !== null && p.daily_rate !== null && ` · ${p.work_days} gün × ${formatCurrency(p.daily_rate)}`}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
