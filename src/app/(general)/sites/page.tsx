import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarDays, ChevronRight, MapPin, Plus } from "lucide-react";
import { ChequeAlerts } from "@/components/cheques/cheque-alerts";
import { requireUser } from "@/lib/auth/session";
import { getChequeAlerts } from "@/lib/cheques/queries";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Şantiyeler — ÖZN YOL" };

type SiteCardData = {
  id: number;
  name: string;
  address: string | null;
  start_date: string | null;
  status: "active" | "closed" | "archived";
};

/**
 * Şantiye seçim ekranı (CLAUDE.md 7.3-B). Liste RLS ile süzülür: ortak yalnızca üyesi olduğu,
 * admin tüm şantiyeleri (salt görüntüleme) görür. "Yeni Şantiye Ekle" her ortağın işidir; admin ekleyemez. Her kartta şantiyenin toplam net bakiyesi (gelir − gider) gösterilir; birleşik "tüm şantiyeler" toplamı bilinçli olarak YOK (şantiyeler izole).
 */
export default async function SitesPage() {
  const supabase = await createClient();
  const [profile, { data }, { data: totalsData }, chequeAlerts] = await Promise.all([
    requireUser(),
    supabase
      .from("sites")
      .select("id, name, address, start_date, status")
      .order("status") // 'active' 'closed'tan önce gelir
      .order("name"),
    supabase.rpc("get_sites_cash_totals"),
    getChequeAlerts(null),
  ]);
  const net = new Map(
    ((totalsData as { site_id: number; income: number | string; expense: number | string }[] | null) ?? []).map((r) => [
      r.site_id,
      Number(r.income) - Number(r.expense),
    ]),
  );
  const isAdmin = profile.role === "admin";
  const ORDER = { active: 0, closed: 1, archived: 2 } as const;
  const sites = ((data as SiteCardData[] | null) ?? []).slice().sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name, "tr"));
  const firstArchived = sites.findIndex((s) => s.status === "archived");

  if (sites.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center">
        <Building2 className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold">
          {isAdmin ? "Henüz şantiye yok" : "Henüz bir şantiyeniz yok"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Şantiyeleri ortaklar kendi panellerinden oluşturur."
            : "İlk şantiyenizi ekleyin. Ekleyen kişi şantiyenin sahibi olur; diğer ortakları sonra ekleyebilirsiniz."}
        </p>
        {!isAdmin && (
          <Link
            href="/sites/yeni"
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" aria-hidden />
            İlk şantiyemi ekle
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tüm şantiyelerdeki vadesi yaklaşan / geçmiş çekler */}
      <ChequeAlerts alerts={chequeAlerts} showSite cekHref={(id) => `/sites/${id}/cekler`} />
      <p className="text-sm text-muted-foreground">
        {isAdmin ? "Tüm şantiyeler (salt görüntüleme)." : "Çalışmak istediğiniz şantiyeyi seçin."}
      </p>
      <ul className="grid grid-cols-1 gap-3 md:max-w-2xl">
        {sites.map((site, i) => (
          <li key={site.id} className="space-y-3">
            {i === firstArchived && (
              <p className="px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arşiv · salt okunur</p>
            )}
            <Link
              href={`/sites/${site.id}`}
              className={cn(
                "flex min-h-20 items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/50",
                (site.status === "closed" || site.status === "archived") && "opacity-80",
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{site.name}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      site.status === "active"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                        : site.status === "archived"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {site.status === "active" ? "Aktif" : site.status === "archived" ? "Arşivde" : "Kapalı"}
                  </span>
                </span>
                {site.address && (
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <MapPin className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{site.address}</span>
                  </span>
                )}
                {site.start_date && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="size-3 shrink-0" aria-hidden />
                    Başlangıç: {formatDate(site.start_date)}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[11px] text-muted-foreground">Net bakiye</span>
                <span
                  className={cn(
                    "block text-sm font-semibold tabular-nums",
                    (net.get(site.id) ?? 0) >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                  )}
                >
                  {formatCurrency(net.get(site.id) ?? 0)}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}

        {!isAdmin && (
          <li>
            <Link
              href="/sites/yeni"
              className="flex min-h-16 items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              <Plus className="size-5" aria-hidden />
              Yeni Şantiye Ekle
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
