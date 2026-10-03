import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Şantiyeler — ÖZN YOL" };

type SiteRow = {
  id: number;
  name: string;
  status: "active" | "closed" | "archived";
  site_members: { role: string; users: { full_name: string } | null }[];
};

/** Tüm şantiyelerin listesi. Admin şantiye oluşturmaz ve üye eklemez; detayda düzenler, arşive alır veya (verisi yoksa) siler. */
export default async function AdminSitesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from("sites")
    .select("id, name, status, site_members(role, users(full_name))")
    .order("status")
    .order("name");
  const ORDER = { active: 0, closed: 1, archived: 2 } as const;
  const sites = ((data as SiteRow[] | null) ?? []).slice().sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name, "tr"));
  const firstArchived = sites.findIndex((s) => s.status === "archived");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Şantiyeler</h1>
        <p className="text-sm text-muted-foreground">
          Şantiyeleri ortaklar kendi panellerinden oluşturur. Bir şantiyeye dokunarak düzenleyebilir, arşive alabilir veya verisi yoksa silebilirsiniz.
        </p>
      </div>

      {sites.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
          <Building2 className="size-10 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">Henüz şantiye yok</h2>
          <p className="text-sm text-muted-foreground">Bir ortak kendi panelinden şantiye oluşturduğunda burada görünür.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:max-w-3xl">
          {sites.map((site, i) => {
            const owner = site.site_members.find((m) => m.role === "owner")?.users?.full_name;
            const count = site.site_members.length;
            return (
              <li key={site.id} className="space-y-3">
                {i === firstArchived && (
                  <p className="px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arşiv</p>
                )}
                <Link
                  href={`/admin/santiyeler/${site.id}`}
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/50",
                    (site.status === "closed" || site.status === "archived") && "opacity-80",
                  )}
                >
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
                    <span className="block truncate text-sm text-muted-foreground">
                      {owner ? `Sahibi: ${owner}` : "Sahip yok"} · {count} üye
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
