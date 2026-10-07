import Link from "next/link";
import { BellRing } from "lucide-react";
import type { ChequeAlert } from "@/lib/cheques/queries";
import { dueText } from "@/lib/cheques/schemas";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Çek uyarıları (ana sayfa ve şantiye seçim ekranı): vadesi geçmiş ve 7 gün içinde gelen BEKLEYEN çekler.
 * Vadesi geçmiş kırmızı, yaklaşan amber. Uyarı yoksa hiçbir şey çizilmez (ekran kalabalık olmasın).
 */
export function ChequeAlerts({ alerts, cekHref, showSite = false, limit = 5 }: { alerts: ChequeAlert[]; cekHref: (siteId: number) => string; showSite?: boolean; limit?: number }) {
  if (alerts.length === 0) return null;
  const overdue = alerts.filter((a) => a.daysLeft < 0).length;
  const soon = alerts.length - overdue;
  const shown = alerts.slice(0, limit);
  const more = alerts.length - shown.length;
  const first = alerts[0];

  return (
    <section
      aria-label="Çek uyarıları"
      data-testid="cheque-alerts"
      className={cn("rounded-xl border-2 p-4", overdue > 0 ? "border-red-500/60 bg-red-500/10" : "border-amber-500/60 bg-amber-500/10")}
    >
      <div className="flex items-start gap-3">
        <BellRing className={cn("mt-0.5 size-5 shrink-0", overdue > 0 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300")} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Çek uyarısı</h2>
          <p className="mt-0.5 text-sm" data-testid="cheque-alerts-summary">
            {overdue > 0 && <span className="font-semibold text-red-600 dark:text-red-400">{overdue} çekin vadesi geçti</span>}
            {overdue > 0 && soon > 0 && " · "}
            {soon > 0 && <span className="font-semibold text-amber-700 dark:text-amber-300">{soon} çekin vadesi yaklaşıyor</span>}
          </p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border/60 rounded-lg bg-background/40">
        {shown.map((a) => {
          const late = a.daysLeft < 0;
          return (
            <li key={a.id}>
              <Link href={cekHref(a.siteId)} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-background/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.counterparty}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.direction === "received" ? "Tahsil edilecek" : "Ödenecek"} · {formatDate(a.dueDate)}
                    {showSite && ` · ${a.siteName}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={cn("block text-sm font-semibold tabular-nums", a.direction === "received" ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400")}>{formatCurrency(a.amount)}</span>
                  <span className={cn("block text-xs font-semibold", late ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300")}>{dueText(a.daysLeft)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{more > 0 ? `+${more} çek daha` : ""}</span>
        <Link href={cekHref(first.siteId)} className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
          Çeklere git →
        </Link>
      </div>
    </section>
  );
}
