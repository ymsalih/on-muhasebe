import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, FileWarning, Scale, TriangleAlert } from "lucide-react";
import { BillingBoard } from "@/components/billing/billing-board";
import { getAuthUserId, requireUser } from "@/lib/auth/session";
import { BILLING_LIST_LIMIT, getBillingOwners, getBillingSummary, listInvoices, listProgressPayments } from "@/lib/billing/queries";
import { remainingInvoice } from "@/lib/billing/schemas";
import { formatCurrency } from "@/lib/format";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Hakediş ve Fatura — Şantiye Ön Muhasebe" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hakediş ve Fatura: toplam hakediş ile kesilen fatura toplamının denkliği. Kalan = hakediş − fatura.
 * Her ortağın kayıtları KENDİNE özeldir (RLS): ortak yalnızca kendininkini görür; admin ortakları ayrı ayrı salt okur.
 * Tarih filtresi yoktur: denklik birikimlidir (tüm hakediş ve tüm fatura).
 */
export default async function BillingPage({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ ortak?: string }> }) {
  const { siteId: rawId } = await params;
  const sp = await searchParams;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const today = todayInIstanbul();
  const base = `/sites/${siteId}/hakedis`;
  const uid = await getAuthUserId(); // JWT'den yerel okunur (ağ turu yok)
  if (!uid) notFound();

  // Ortak için tek tur: veri, kimlik doğrulamayla birlikte (paralel) istenir. Admin yalnızca seçtiği ortağı görür.
  const requested = sp.ortak && UUID.test(sp.ortak) ? sp.ortak : uid;
  const fetchFor = (ownerId: string) =>
    Promise.all([getBillingSummary(siteId, ownerId), listProgressPayments(siteId, ownerId), listInvoices(siteId, ownerId)]);
  const [profile, role, owners, first] = await Promise.all([requireUser(), getSiteRole(siteId), getBillingOwners(siteId), fetchFor(requested)]);

  const isAdmin = profile.role === "admin";
  const ownerId = isAdmin ? (sp.ortak && UUID.test(sp.ortak) ? sp.ortak : (owners[0]?.id ?? uid)) : uid;
  const [summary, payments, invoices] = ownerId === requested ? first : await fetchFor(ownerId);
  const canWrite = canWriteRole(role);
  const ownerName = owners.find((o) => o.id === ownerId)?.name;

  const remaining = remainingInvoice(summary.progressTotal, summary.invoiceTotal);
  const empty = summary.progressCount === 0 && summary.invoiceCount === 0;

  const status = empty
    ? { tone: "border-border bg-card", icon: Scale, title: "Henüz kayıt yok", amount: null as string | null, text: "Hakediş ve fatura girdikçe eklemeniz gereken fatura tutarı burada hesaplanır.", amountTone: "" }
    : remaining > 0
      ? { tone: "border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/20", icon: FileWarning, title: "Eklemeniz gereken fatura", amount: formatCurrency(remaining), text: "Toplam hakediş − toplam fatura. Bu tutarda fatura daha kesmeniz gerekiyor.", amountTone: "text-amber-700 dark:text-amber-400" }
      : remaining === 0
        ? { tone: "border-emerald-600/40 bg-emerald-50/60 dark:bg-emerald-950/20", icon: CheckCircle2, title: "Hakediş ve fatura denk", amount: formatCurrency(0), text: "Kestiğiniz faturaların toplamı hakediş toplamına eşit. Eklenecek fatura yok.", amountTone: "text-emerald-700 dark:text-emerald-400" }
        : { tone: "border-red-600/40 bg-red-50/60 dark:bg-red-950/20", icon: TriangleAlert, title: "Fatura hakedişi aşıyor", amount: formatCurrency(Math.abs(remaining)), text: "Kestiğiniz faturaların toplamı hakediş toplamından fazla. Fazla kesilen tutar yanda.", amountTone: "text-red-600 dark:text-red-400" };
  const StatusIcon = status.icon;

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold">Hakediş ve Fatura</h1>

      {isAdmin ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Her ortağın kaydı ayrıdır. Salt görüntüleme.</p>
          {owners.length === 0 ? (
            <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Bu şantiyede henüz hakediş veya fatura kaydı yok.</p>
          ) : (
            <nav aria-label="Ortak seç" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
              <div className="inline-flex rounded-lg bg-muted p-1">
                {owners.map((o) => (
                  <Link
                    key={o.id}
                    href={`${base}?ortak=${o.id}`}
                    scroll={false}
                    aria-current={o.id === ownerId ? "true" : undefined}
                    className={cn("inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3.5 text-sm font-medium", o.id === ownerId ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                  >
                    {o.name}
                  </Link>
                ))}
              </div>
            </nav>
          )}
          {ownerName && <p className="text-sm font-medium">{ownerName}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Bu şantiyede yalnızca sizin girdiğiniz kayıtlar; diğer ortakların kayıtları sizden ayrıdır.</p>
      )}

      {(!isAdmin || owners.length > 0) && (
        <>
          <BillingBoard
            siteId={siteId}
            canWrite={canWrite}
            today={today}
            payments={payments.rows}
            invoices={invoices.rows}
            paymentsHasMore={payments.hasMore || payments.rows.length > BILLING_LIST_LIMIT}
            invoicesHasMore={invoices.hasMore || invoices.rows.length > BILLING_LIST_LIMIT}
            summary={summary}
          />

          <section aria-label="Eklenmesi gereken fatura" className={cn("space-y-2 rounded-xl border-2 p-4", status.tone)} data-testid="billing-status">
            <div className="flex items-start gap-3">
              <StatusIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">{status.title}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{status.text}</p>
              </div>
            </div>
            {status.amount && <p className={cn("text-right text-2xl font-bold tabular-nums", status.amountTone)} data-testid="remaining-amount">{status.amount}</p>}
            <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Toplam hakediş</dt>
                <dd className="font-semibold tabular-nums">{formatCurrency(summary.progressTotal)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Toplam fatura</dt>
                <dd className="font-semibold tabular-nums">{formatCurrency(summary.invoiceTotal)}</dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
