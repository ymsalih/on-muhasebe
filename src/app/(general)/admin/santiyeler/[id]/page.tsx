import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SiteManage } from "@/components/sites/site-manage";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { getSiteDataSummary } from "@/lib/sites/manage";
import { SITE_MEMBER_ROLE_LABELS, type SiteMemberRole } from "@/lib/sites/schemas";

export const metadata: Metadata = { title: "Şantiye Detayı — ÖZN YOL" };

type SiteDetail = {
  id: number;
  name: string;
  address: string | null;
  start_date: string | null;
  status: "active" | "closed" | "archived";
  site_members: {
    id: number;
    role: SiteMemberRole;
    archived_at: string | null;
    users: { full_name: string; email: string } | null;
  }[];
};

const STATUS_LABELS = { active: "Aktif", closed: "Kapalı", archived: "Arşivde" } as const;

/**
 * Admin: şantiyeyi görüntüler, düzenler, arşive alır veya (verisi yoksa) siler. Admin şantiye OLUŞTURMAZ, üye EKLEMEZ ve
 * operasyonel veri YAZMAZ; üye yönetimi şantiye sahibinindir.
 */
export default async function AdminSiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId)) notFound();

  const supabase = await createClient();
  const [{ data }, summary] = await Promise.all([
    supabase
      .from("sites")
      .select("id, name, address, start_date, status, site_members(id, role, archived_at, users(full_name, email))")
      .eq("id", siteId)
      .maybeSingle(),
    getSiteDataSummary(siteId),
  ]);

  const site = data as SiteDetail | null;
  if (!site) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/admin/santiyeler" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Şantiyeler
      </Link>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{site.name}</h1>
        <p className="text-sm text-muted-foreground">
          {STATUS_LABELS[site.status]} · {site.address ?? "Adres girilmedi"}
          {site.start_date && ` · Başlangıç: ${formatDate(site.start_date)}`}
        </p>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Üyeler</h2>
        {site.site_members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu şantiyede üye yok.</p>
        ) : (
          <ul className="divide-y">
            {site.site_members.map((m) => (
              <li key={m.id} className="py-2.5">
                <p className="truncate text-sm font-medium">{m.users?.full_name ?? "—"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {SITE_MEMBER_ROLE_LABELS[m.role]}
                  {m.archived_at && " · arşivde"}
                  {m.users && ` · ${m.users.email}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Üyeleri şantiyenin sahibi yönetir; admin üye ekleyemez.</p>
      </section>

      <SiteManage
        siteId={site.id}
        initial={{ name: site.name, address: site.address ?? "", startDate: site.start_date ?? "" }}
        status={site.status}
        summary={summary}
        afterDeleteHref="/admin/santiyeler"
      />
    </div>
  );
}
