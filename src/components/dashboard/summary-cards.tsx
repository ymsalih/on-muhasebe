import { Scale, TrendingDown, TrendingUp, UserCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

/** null: ilgili modül henüz teslim edilmedi (veri yok) — "—" gösterilir, sahte 0 yazılmaz. */
export type SummaryValues = {
  monthIncome: number | null;
  monthExpense: number | null;
  presentToday: number | null;
};

type CardProps = {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone: "income" | "expense" | "neutral";
};

const TONES = {
  income: { icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400", value: "text-emerald-700 dark:text-emerald-400" },
  expense: { icon: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400", value: "text-orange-700 dark:text-orange-400" },
  neutral: { icon: "bg-muted text-muted-foreground", value: "text-foreground" },
} as const;

function SummaryCard({ label, value, hint, icon: Icon, tone }: CardProps) {
  const t = TONES[tone];
  return (
    <div className="min-w-[70%] shrink-0 snap-start rounded-xl border bg-card p-4 sm:min-w-[45%] md:min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("flex size-8 items-center justify-center rounded-lg", t.icon)}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <p className={cn("text-2xl font-semibold tabular-nums", t.value)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Şantiye dashboard'u üst özet kartları (CLAUDE.md 7.3-C): mobilde yatay kaydırma, masaüstünde 4'lü grid. */
export function SummaryCards({ monthIncome, monthExpense, presentToday }: SummaryValues) {
  const hasCash = monthIncome !== null && monthExpense !== null;
  const net = hasCash ? monthIncome - monthExpense : null;
  const netTone = net === null ? "neutral" : net >= 0 ? "income" : "expense";

  return (
    <section aria-label="Bu ay özeti">
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        <SummaryCard
          label="Bu Ay Gelir"
          icon={TrendingUp}
          tone="income"
          value={monthIncome === null ? "—" : formatCurrency(monthIncome)}
          hint={monthIncome === null ? "Genel Kasa ile aktif olacak" : undefined}
        />
        <SummaryCard
          label="Bu Ay Gider"
          icon={TrendingDown}
          tone="expense"
          value={monthExpense === null ? "—" : formatCurrency(monthExpense)}
          hint={monthExpense === null ? "Genel Kasa ile aktif olacak" : undefined}
        />
        <SummaryCard
          label="Net Bakiye"
          icon={Scale}
          tone={netTone}
          value={net === null ? "—" : formatCurrency(net)}
          hint={net === null ? "Genel Kasa ile aktif olacak" : undefined}
        />
        <SummaryCard
          label="Bugün Gelen Personel"
          icon={UserCheck}
          tone="neutral"
          value={presentToday === null ? "—" : String(presentToday)}
          hint={presentToday === null ? "Puantaj ile aktif olacak" : "kişi"}
        />
      </div>
    </section>
  );
}
