import { FilePlus2, Receipt, UserCheck, Wallet } from "lucide-react";
import { SummaryCards } from "@/components/dashboard/summary-cards";

/**
 * Şantiye ana sayfası (CLAUDE.md 7.3-C).
 * Kasa ve puantaj tabloları henüz yok (Faz 5 / Faz 7): kartlar "—" gösterir, gerçek veriyle
 * bağlanma Faz 7'de yapılır. Sahte 0 değerleri gösterilmez.
 */
export default function SiteHomePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <SummaryCards monthIncome={null} monthExpense={null} presentToday={null} />

      <section aria-labelledby="recent-heading" className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="recent-heading" className="font-semibold">
            Son Kasa Hareketleri
          </h2>
          <span aria-disabled="true" className="text-sm text-muted-foreground/60">
            Tümünü Gör
          </span>
        </div>
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <Receipt className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Henüz kasa hareketi yok</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Gelir ve giderler Genel Kasa modülü eklendiğinde burada listelenecek.
          </p>
        </div>
      </section>

      <section aria-label="Hızlı eylemler" className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Gelir/Gider Ekle", icon: Wallet },
          { label: "Günlük Gelenler", icon: UserCheck },
          { label: "İrsaliye Ekle", icon: FilePlus2 },
        ].map(({ label, icon: Icon }) => (
          <span
            key={label}
            aria-disabled="true"
            title="Yakında"
            className="flex min-h-12 cursor-not-allowed items-center justify-center gap-2 rounded-xl border bg-card px-4 text-sm font-medium text-muted-foreground/60"
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </span>
        ))}
      </section>
    </div>
  );
}
