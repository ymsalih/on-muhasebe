import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PARTY_CATEGORY_LABELS, type PartyCategory } from "@/lib/goods/schemas";

/**
 * Bakiye = Tahsilat − Ödeme (party_balances). Renk (CLAUDE.md 7.1, gelir yeşil / gider kırmızı-turuncu):
 * pozitif (tahsilat fazla) yeşil, negatif (ödeme fazla) kırmızı, sıfır nötr.
 */
export function balanceTone(balance: number) {
  if (balance > 0) return "text-emerald-700 dark:text-emerald-400";
  if (balance < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

export function balanceLabel(balance: number) {
  if (balance > 0) return "Tahsilat fazla";
  if (balance < 0) return "Ödeme fazla";
  return "Denk";
}

export function BalanceAmount({ balance, withLabel = true, className }: { balance: number; withLabel?: boolean; className?: string }) {
  return (
    <span className={cn("block", className)}>
      <span className={cn("block font-semibold tabular-nums", balanceTone(balance))}>{formatCurrency(balance)}</span>
      {withLabel && <span className="block text-[11px] font-normal text-muted-foreground">{balanceLabel(balance)}</span>}
    </span>
  );
}

const CATEGORY_TONE: Record<PartyCategory, string> = {
  firma: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400",
  nakliyeci: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  arac: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400",
  musteri: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  diger: "bg-muted text-muted-foreground",
};

export function CategoryBadge({ category }: { category: PartyCategory }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", CATEGORY_TONE[category])}>
      {PARTY_CATEGORY_LABELS[category]}
    </span>
  );
}
