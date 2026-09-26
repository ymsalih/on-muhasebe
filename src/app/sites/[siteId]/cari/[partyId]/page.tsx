import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Pencil, Phone, StickyNote } from "lucide-react";
import { BalanceAmount, CategoryBadge, balanceTone } from "@/components/parties/balance";
import { PartyTransactions } from "@/components/parties/party-transactions";
import { requireUser } from "@/lib/auth/session";
import { listCategories } from "@/lib/cash/queries";
import { formatCurrency } from "@/lib/format";
import { TRANSACTION_LIST_LIMIT, getParty, getPartyBalance, listPartyTransactions } from "@/lib/parties/queries";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cari Detayı — Şantiye Ön Muhasebe" };

/** Cari detay (CLAUDE.md 7.3-F): ciro + bakiye kartı, kronolojik hareketler, "Ödeme/Tahsilat Ekle". */
export default async function PartyDetailPage({ params }: { params: Promise<{ siteId: string; partyId: string }> }) {
  const { siteId: rawSite, partyId: rawParty } = await params;
  const siteId = Number(rawSite);
  const partyId = Number(rawParty);
  if (!Number.isInteger(siteId) || !Number.isInteger(partyId)) notFound();

  const [, role, party, balance, transactions, categories] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    getParty(siteId, partyId),
    getPartyBalance(siteId, partyId),
    listPartyTransactions(siteId, partyId),
    listCategories(siteId),
  ]);
  if (!party || !balance) notFound();
  const canWrite = canWriteRole(role);

  return (
    <div className="max-w-3xl space-y-5">
      <Link href={`/sites/${siteId}/cari`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Cari Hesaplar
      </Link>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="break-words text-xl font-semibold">{party.name}</h1>
            <CategoryBadge category={party.category} />
          </div>
          {canWrite && (
            <Link
              href={`/sites/${siteId}/cari/${partyId}/duzenle`}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
            >
              <Pencil className="size-4" aria-hidden />
              Düzenle
            </Link>
          )}
        </div>
        {(party.phone || party.address || party.notes) && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {party.phone && (
              <li className="flex items-center gap-2">
                <Phone className="size-4 shrink-0" aria-hidden />
                <a href={`tel:${party.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 items-center text-foreground underline-offset-4 hover:underline">
                  {party.phone}
                </a>
              </li>
            )}
            {party.address && (
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{party.address}</span>
              </li>
            )}
            {party.notes && (
              <li className="flex items-start gap-2">
                <StickyNote className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{party.notes}</span>
              </li>
            )}
          </ul>
        )}
      </div>

      <section aria-label="Cari özeti" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Toplam Ciro</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(balance.total_turnover)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Toplam Tahsilat</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(balance.total_income)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Toplam Ödeme</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(balance.total_expense)}</p>
        </div>
        <div className={cn("rounded-xl border bg-card p-4")}>
          <p className="text-xs text-muted-foreground">Bakiye</p>
          <BalanceAmount balance={balance.balance} className={cn("mt-1 text-lg", balanceTone(balance.balance))} />
        </div>
      </section>
      <p className="-mt-2 text-xs text-muted-foreground">Bakiye = Tahsilat − Ödeme. Yeşil: tahsilat fazla · Kırmızı: ödeme fazla.</p>

      <PartyTransactions
        siteId={siteId}
        party={{ id: partyId, name: party.name }}
        transactions={transactions}
        categories={categories}
        canWrite={canWrite}
        today={todayInIstanbul()}
        limit={TRANSACTION_LIST_LIMIT}
      />
    </div>
  );
}
