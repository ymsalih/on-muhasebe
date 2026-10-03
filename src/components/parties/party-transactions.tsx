"use client";

import { useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataRow } from "@/components/data-row";
import { TransactionSheet, type SheetTx } from "@/components/cash/transaction-sheet";
import { StickyActionBar } from "@/components/layout/sticky-action-bar";
import type { CategoryOption } from "@/lib/cash/actions";
import type { IncomeSource } from "@/lib/cash/sources";
import type { CashType } from "@/lib/cash/schemas";
import type { PartyTransaction } from "@/lib/parties/queries";
import { PAYMENT_METHOD_LABELS, TX_KIND_LABELS, typeToKind } from "@/lib/parties/schemas";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Cari bağlamında gelir = Tahsilat, gider = Ödeme. */
const LABELS: Record<CashType, string> = { income: "Tahsilat", expense: "Ödeme" };

function toSheetTx(t: PartyTransaction, partyId: number): SheetTx {
  return {
    id: t.id,
    type: t.type,
    amount: t.amount,
    date: t.transaction_date,
    description: t.description,
    categoryId: t.category_id,
    partyId,
    method: t.payment_method,
    sourceIncomeId: t.source_income_id,
  };
}

/**
 * Cari hareketleri (CLAUDE.md 7.3-F): kronolojik liste + sabit alt "Ödeme/Tahsilat Ekle" çubuğu.
 * Ekleme/düzenleme/silme, Genel Kasa ile ORTAK pencereyle (TransactionSheet) yapılır; cari sabittir.
 * Buradaki hareketler aynı zamanda Genel Kasa kayıtlarıdır (Ödeme = gider, Tahsilat = gelir).
 */
export function PartyTransactions({
  siteId,
  party,
  transactions,
  categories,
  canWrite,
  today,
  limit,
  incomeSources,
}: {
  siteId: number;
  party: { id: number; name: string };
  transactions: PartyTransaction[];
  categories: CategoryOption[];
  canWrite: boolean;
  today: string;
  limit: number;
  incomeSources: IncomeSource[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SheetTx | null>(null);

  return (
    <div className="space-y-3 pb-28 md:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Hareketler</h2>
        {transactions.length > 0 && <span className="text-xs text-muted-foreground">{transactions.length} kayıt</span>}
      </div>

      {transactions.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
          <Receipt className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Bu cariye ait hareket yok</p>
          <p className="text-sm text-muted-foreground">
            {canWrite ? "İlk ödeme veya tahsilatı ekleyin; bakiye buna göre hesaplanır." : "Ödeme ve tahsilatlar eklendikçe burada listelenir."}
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {transactions.map((t) => {
            const income = t.type === "income";
            return (
              <DataRow
                key={t.id}
                onClick={
                  canWrite
                    ? () => {
                        setEditing(toSheetTx(t, party.id));
                        setOpen(true);
                      }
                    : undefined
                }
                title={t.description}
                badge={
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      income
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                        : "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
                    )}
                  >
                    {TX_KIND_LABELS[typeToKind(t.type)]}
                  </span>
                }
                lines={[
                  [formatDate(t.transaction_date), t.payment_method && PAYMENT_METHOD_LABELS[t.payment_method], t.categories?.name].filter(Boolean).join(" · "),
                  t.users?.full_name && `${t.users.full_name} girdi`,
                ]}
                trailing={
                  <span className={cn("font-semibold tabular-nums", income ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400")}>
                    {income ? "+" : "−"}
                    {formatCurrency(t.amount)}
                  </span>
                }
              />
            );
          })}
        </div>
      )}
      {transactions.length >= limit && <p className="text-center text-xs text-muted-foreground">En yeni {limit} hareket gösteriliyor.</p>}

      {canWrite && (
        <StickyActionBar>
          <Button
            type="button"
            className="h-12 flex-1 text-base md:flex-none md:px-6"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus aria-hidden />
            Ödeme / Tahsilat Ekle
          </Button>
        </StickyActionBar>
      )}

      <TransactionSheet
        siteId={siteId}
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        categories={categories}
        parties={[]}
        lockedParty={party}
        labels={LABELS}
        today={today}
        defaultType="expense"
        incomeSources={incomeSources}
      />
    </div>
  );
}
