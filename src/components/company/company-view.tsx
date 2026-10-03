import Link from "next/link";
import { ChevronLeft, ChevronRight, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { CompanyLedger } from "@/components/company/company-ledger";
import { periodParams, type CompanyPeriod } from "@/lib/company/period";
import type { CompanyEntryRow, CompanySummary } from "@/lib/company/queries";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

function href(base: string, p: { mode: "ay" | "yil"; key: string }) {
  const sp = new URLSearchParams(periodParams(p));
  return `${base}?${sp.toString()}`;
}

/** Şirket kasası ekranı: dönem seçici (ay/yıl), hareket listesi ve en altta kâr/zarar. Ortak (yazar) ve admin (salt okur) ortak kullanır. */
export function CompanyView({
  base,
  period,
  summary,
  rows,
  hasMore,
  canWrite,
  today,
}: {
  base: string;
  period: CompanyPeriod;
  summary: CompanySummary;
  rows: CompanyEntryRow[];
  hasMore: boolean;
  canWrite: boolean;
  today: string;
}) {
  const profit = summary.result >= 0;
  const switchTo = period.mode === "ay" ? { mode: "yil" as const, key: period.from.slice(0, 4) } : { mode: "ay" as const, key: period.from.slice(0, 7) };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Dönem türü" className="inline-flex rounded-lg bg-muted p-1">
          {([{ mode: "ay", label: "Aylık" }, { mode: "yil", label: "Yıllık" }] as const).map((o) => (
            <Link
              key={o.mode}
              href={href(base, o.mode === period.mode ? { mode: period.mode, key: period.mode === "ay" ? period.from.slice(0, 7) : period.from.slice(0, 4) } : switchTo)}
              scroll={false}
              aria-current={period.mode === o.mode ? "true" : undefined}
              className={cn("inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium", period.mode === o.mode ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {o.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto inline-flex items-center gap-1">
          <Link href={href(base, period.prev)} scroll={false} aria-label="Önceki dönem" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <Link href={href(base, period.current)} scroll={false} className="inline-flex min-h-11 min-w-32 items-center justify-center rounded-lg border px-3 text-sm font-medium hover:bg-muted" aria-label="Bu döneme dön">
            {period.label}
          </Link>
          <Link href={href(base, period.next)} scroll={false} aria-label="Sonraki dönem" className="inline-flex size-11 items-center justify-center rounded-lg border hover:bg-muted">
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <CompanyLedger
        rows={rows.map((r) => ({ id: r.id, type: r.entry_type, date: r.entry_date, description: r.description, amount: r.amount }))}
        hasMore={hasMore}
        canWrite={canWrite}
        today={today}
      />

      <section aria-label="Kâr / zarar" className={cn("space-y-3 rounded-xl border-2 p-4", profit ? "border-emerald-600/40 bg-emerald-50/50 dark:bg-emerald-950/20" : "border-red-600/40 bg-red-50/50 dark:bg-red-950/20")}>
        <h2 className="text-sm font-semibold">Kâr / Zarar — {period.label}</h2>
        <dl className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <TrendingUp className="size-4 shrink-0" aria-hidden />
              Toplam Gelir
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatCurrency(summary.income)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <TrendingDown className="size-4 shrink-0" aria-hidden />
              Toplam Gider
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-orange-700 dark:text-orange-400">{formatCurrency(summary.expense)}</dd>
          </div>
        </dl>
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Scale className="size-4" aria-hidden />
            {profit ? "Kâr" : "Zarar"}
          </span>
          <span className={cn("text-2xl font-bold tabular-nums", profit ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
            {formatCurrency(Math.abs(summary.result))}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Yalnızca şirket kasasındaki kayıtlardan hesaplanır; şantiye kasası hareketleri dahil değildir.</p>
      </section>
    </div>
  );
}
