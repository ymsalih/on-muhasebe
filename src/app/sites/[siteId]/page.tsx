import Link from "next/link";
import { notFound } from "next/navigation";
import { FilePlus2, Receipt, UserCheck, Wallet } from "lucide-react";
import { ChequeAlerts } from "@/components/cheques/cheque-alerts";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { DataRow } from "@/components/data-row";
import { requireUser } from "@/lib/auth/session";
import { countPresent } from "@/lib/attendance/queries";
import { getCashSummary, listCashTransactions } from "@/lib/cash/queries";
import { getChequeAlerts } from "@/lib/cheques/queries";
import { monthBounds } from "@/lib/cash/range";
import { formatCurrency, formatDate } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/parties/schemas";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

const ACTION_CLASS = "flex min-h-12 items-center justify-center gap-2 rounded-xl border bg-card px-4 text-sm font-medium";

/**
 * Şantiye ana sayfası (CLAUDE.md 7.3-C): bu ay gelir/gider/net (Genel Kasa), bugün gelen personel (puantaj),
 * son 5 kasa hareketi ve hızlı eylemler. Tüm veri kimlik doğrulamayla birlikte paralel istenir.
 */
export default async function SiteHomePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const today = todayInIstanbul();
  const month = monthBounds(today);
  const [, role, presentToday, summary, recent, chequeAlerts] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    countPresent(siteId, today),
    getCashSummary(siteId, month.from, month.to),
    listCashTransactions(siteId, {}, 5),
    getChequeAlerts(siteId),
  ]);
  const canWrite = canWriteRole(role);
  const base = `/sites/${siteId}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Vadesi yaklaşan / geçmiş çekler: kaçırılmasın diye en üstte; uyarı yoksa görünmez */}
      <ChequeAlerts alerts={chequeAlerts} cekHref={(id) => `/sites/${id}/cekler`} />

      <SummaryCards monthIncome={summary.income} monthExpense={summary.expense} presentToday={presentToday} />

      <section aria-labelledby="recent-heading" className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="recent-heading" className="font-semibold">
            Son Kasa Hareketleri
          </h2>
          <Link href={`${base}/kasa`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
            Tümünü Gör
          </Link>
        </div>
        {recent.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Receipt className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">Henüz kasa hareketi yok</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {canWrite ? "İlk gelir veya gideri ekleyerek kasayı başlatın." : "Gelir ve giderler eklendikçe burada listelenir."}
            </p>
            {canWrite && (
              <Link href={`${base}/kasa?ekle=1`} className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
                İlk hareketi ekle
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {recent.rows.map((r) => {
              const income = r.type === "income";
              return (
                <DataRow
                  key={r.id}
                  href={`${base}/kasa`}
                  title={r.description}
                  badge={
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{r.categories?.name ?? "Kategorisiz"}</span>
                  }
                  lines={[
                    [formatDate(r.transaction_date), r.payment_method && PAYMENT_METHOD_LABELS[r.payment_method], r.parties?.name].filter(Boolean).join(" · "),
                  ]}
                  trailing={
                    <span className={cn("font-semibold tabular-nums", income ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400")}>
                      {income ? "+" : "−"}
                      {formatCurrency(r.amount)}
                    </span>
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <section aria-label="Hızlı eylemler" className="grid gap-3 sm:grid-cols-3">
        {canWrite ? (
          <Link href={`${base}/kasa?ekle=1`} className={`${ACTION_CLASS} hover:bg-muted/50`}>
            <Wallet className="size-5" aria-hidden />
            Gelir/Gider Ekle
          </Link>
        ) : (
          <Link href={`${base}/kasa`} className={`${ACTION_CLASS} hover:bg-muted/50`}>
            <Wallet className="size-5" aria-hidden />
            Genel Kasa
          </Link>
        )}
        <Link href={`${base}/puantaj`} className={`${ACTION_CLASS} hover:bg-muted/50`}>
          <UserCheck className="size-5" aria-hidden />
          Günlük Gelenler
        </Link>
        {canWrite ? (
          <Link href={`${base}/irsaliye/yeni`} className={`${ACTION_CLASS} hover:bg-muted/50`}>
            <FilePlus2 className="size-5" aria-hidden />
            İrsaliye Ekle
          </Link>
        ) : (
          <Link href={`${base}/irsaliye`} className={`${ACTION_CLASS} hover:bg-muted/50`}>
            <FilePlus2 className="size-5" aria-hidden />
            İrsaliyeler
          </Link>
        )}
      </section>
    </div>
  );
}
