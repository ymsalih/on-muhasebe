import Link from "next/link";
import { notFound } from "next/navigation";
import { FilePlus2, Receipt, UserCheck, Wallet, type LucideIcon } from "lucide-react";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { requireUser } from "@/lib/auth/session";
import { countPresent } from "@/lib/attendance/queries";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";

const ACTION_CLASS = "flex min-h-12 items-center justify-center gap-2 rounded-xl border bg-card px-4 text-sm font-medium";

function ComingSoon({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <span aria-disabled="true" title="Yakında" className={`${ACTION_CLASS} cursor-not-allowed text-muted-foreground/60`}>
      <Icon className="size-5" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Şantiye ana sayfası (CLAUDE.md 7.3-C).
 * "Bugün Gelen Personel" puantajdan (Faz 5) gelir. Kasa tablosu henüz yok (Faz 7): gelir/gider kartları "—"
 * gösterir, gerçek veriyle bağlanma Faz 7'de yapılır. Sahte 0 değerleri gösterilmez.
 */
export default async function SiteHomePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const [, role, presentToday] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    countPresent(siteId, todayInIstanbul()),
  ]);
  const canWrite = canWriteRole(role);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <SummaryCards monthIncome={null} monthExpense={null} presentToday={presentToday} />

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
        <ComingSoon label="Gelir/Gider Ekle" icon={Wallet} />
        <Link href={`/sites/${siteId}/puantaj`} className={`${ACTION_CLASS} hover:bg-muted/50`}>
          <UserCheck className="size-5" aria-hidden />
          Günlük Gelenler
        </Link>
        {canWrite ? (
          <Link href={`/sites/${siteId}/irsaliye/yeni`} className={`${ACTION_CLASS} hover:bg-muted/50`}>
            <FilePlus2 className="size-5" aria-hidden />
            İrsaliye Ekle
          </Link>
        ) : (
          <ComingSoon label="İrsaliye Ekle" icon={FilePlus2} />
        )}
      </section>
    </div>
  );
}
