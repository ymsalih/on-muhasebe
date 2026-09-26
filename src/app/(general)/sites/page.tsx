import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarDays, ChevronRight, MapPin, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Şantiyeler — Şantiye Ön Muhasebe" };

type SiteCardData = {
  id: number;
  name: string;
  address: string | null;
  start_date: string | null;
  status: "active" | "closed";
};

/**
 * Şantiye seçim ekranı (CLAUDE.md 7.3-B). Liste RLS ile süzülür: ortak yalnızca üyesi olduğu,
 * admin tüm şantiyeleri görür. Kartlardaki "bu ay net bakiye" özeti kasa tablosu geldiğinde (Faz 7) eklenecek.
 */
export default async function SitesPage() {
  const profile = await requireUser();
  const isAdmin = profile.role === "admin";

  const supabase = await createClient();
  const { data } = await supabase
    .from("sites")
    .select("id, name, address, start_date, status")
    .order("status") // 'active' 'closed'tan önce gelir
    .order("name");
  const sites = (data as SiteCardData[] | null) ?? [];

  if (sites.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center">
        <Building2 className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold">
          {isAdmin ? "Henüz şantiye eklenmedi" : "Henüz erişebildiğiniz bir şantiye yok"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "İlk şantiyeyi ekleyip ortakları ona atayabilirsiniz."
            : "Yöneticiniz sizi bir şantiyeye eklediğinde burada görünecek."}
        </p>
        {isAdmin && (
          <Link
            href="/admin/santiyeler/yeni"
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" aria-hidden />
            İlk şantiyeyi ekle
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Çalışmak istediğiniz şantiyeyi seçin.</p>
      <ul className="grid gap-3 md:max-w-2xl">
        {sites.map((site) => (
          <li key={site.id}>
            <Link
              href={`/sites/${site.id}`}
              className={cn(
                "flex min-h-20 items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/50",
                site.status === "closed" && "opacity-70",
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
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {site.status === "active" ? "Aktif" : "Kapalı"}
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
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}

        {isAdmin && (
          <li>
            <Link
              href="/admin/santiyeler/yeni"
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
