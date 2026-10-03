"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataRow } from "@/components/data-row";
import { TransactionSheet, type SheetTx } from "@/components/cash/transaction-sheet";
import type { CategoryOption } from "@/lib/cash/actions";
import type { IncomeSource } from "@/lib/cash/sources";
import type { CashRow } from "@/lib/cash/queries";
import type { CashType } from "@/lib/cash/schemas";
import { formatCurrency, formatDate } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/parties/schemas";
import { cn } from "@/lib/utils";

const LABELS: Record<CashType, string> = { income: "Gelir", expense: "Gider" };

export function toSheetTx(r: CashRow): SheetTx {
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    date: r.transaction_date,
    description: r.description,
    categoryId: r.category_id,
    partyId: r.party_id,
    method: r.payment_method,
    sourceIncomeId: r.source_income_id,
  };
}

/**
 * Genel Kasa'nın etkileşimli kısmı (CLAUDE.md 7.3-D): başlık + sağ üst "+ Gelir/Gider Ekle" (masaüstü), mobilde sağ alt
 * yüzen buton (FAB), hareket listesi ve ekleme/düzenleme penceresi. Süzgeç, özet ve grafik `children` olarak
 * sunucuda üretilip araya yerleştirilir.
 */
export function CashLedger({
  siteId,
  rows,
  hasMore,
  moreHref,
  categories,
  parties,
  canWrite,
  today,
  autoOpen,
  filtered,
  incomeSources,
  incomeInfo,
  children,
}: {
  siteId: number;
  rows: CashRow[];
  hasMore: boolean;
  moreHref: string;
  categories: CategoryOption[];
  parties: { id: number; name: string }[];
  canWrite: boolean;
  today: string;
  autoOpen: boolean;
  filtered: boolean;
  incomeSources: IncomeSource[];
  /** Gelir kaydı id → kısa ad, tutar ve ondan harcanan (gider satırında kaynak, gelir satırında harcanan/kalan için) */
  incomeInfo: Record<number, { label: string; amount: number; spent: number }>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(autoOpen && canWrite);
  const [editing, setEditing] = useState<SheetTx | null>(null);

  // Dashboard'daki "Gelir/Gider Ekle" kısayolu (?ekle=1) pencereyi açar; sayfa yenilenince tekrar açılmasın diye adresten kaldırılır.
  useEffect(() => {
    if (!autoOpen) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("ekle");
    window.history.replaceState(null, "", url.pathname + (url.search || ""));
  }, [autoOpen]);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(r: CashRow) {
    setEditing(toSheetTx(r));
    setOpen(true);
  }

  return (
    <div className="max-w-3xl space-y-4 pb-28 md:pb-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Genel Kasa</h1>
        {canWrite && (
          <Button type="button" className="hidden h-11 md:inline-flex" onClick={openNew}>
            <Plus aria-hidden />
            Gelir / Gider Ekle
          </Button>
        )}
      </div>

      {children}

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Hareketler</h2>
        {rows.length > 0 && <span className="text-xs text-muted-foreground">{rows.length}{hasMore ? "+" : ""} kayıt</span>}
      </div>

      {rows.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card px-4 py-12 text-center">
          <Receipt className="size-9 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtered ? "Bu süzgece uyan hareket yok" : "Bu aralıkta hareket yok"}</p>
          <p className="text-sm text-muted-foreground">
            {canWrite ? "Gelir veya gider ekleyerek kasayı doldurmaya başlayın." : "Hareket eklendikçe burada listelenir."}
          </p>
          {canWrite && (
            <Button type="button" className="h-11" onClick={openNew}>
              <Plus aria-hidden />
              İlk hareketi ekle
            </Button>
          )}
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {rows.map((r) => {
            const income = r.type === "income";
            return (
              <DataRow
                key={r.id}
                onClick={canWrite ? () => openEdit(r) : undefined}
                title={r.description}
                badge={
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", r.categories ? "bg-muted text-foreground" : "bg-muted/60 text-muted-foreground")}>
                    {r.categories?.name ?? "Kategorisiz"}
                  </span>
                }
                lines={[
                  [formatDate(r.transaction_date), r.payment_method && PAYMENT_METHOD_LABELS[r.payment_method], r.parties?.name].filter(Boolean).join(" · "),
                  r.users?.full_name && `${r.users.full_name} girdi`,
                  !income && r.source_income_id !== null && `Kaynak gelir: ${incomeInfo[r.source_income_id]?.label ?? "gelir kaydı"}`,
                  income && incomeInfo[r.id] && incomeInfo[r.id].spent > 0 && (
                    <span key="alloc">
                      Harcanan {formatCurrency(incomeInfo[r.id].spent)} ·{" "}
                      <span className={incomeInfo[r.id].amount - incomeInfo[r.id].spent < 0 ? "font-medium text-red-600 dark:text-red-400" : ""}>
                        Kalan {formatCurrency(Math.round((incomeInfo[r.id].amount - incomeInfo[r.id].spent) * 100) / 100)}
                      </span>
                    </span>
                  ),
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

      {hasMore && (
        <Link href={moreHref} scroll={false} className="flex min-h-11 items-center justify-center rounded-lg border text-sm font-medium hover:bg-muted">
          Daha fazla göster
        </Link>
      )}

      {canWrite && (
        <button
          type="button"
          onClick={openNew}
          aria-label="Gelir / Gider Ekle"
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
        >
          <Plus className="size-6" aria-hidden />
        </button>
      )}

      <TransactionSheet
        siteId={siteId}
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        categories={categories}
        parties={parties}
        labels={LABELS}
        today={today}
        incomeSources={incomeSources}
      />
    </div>
  );
}
