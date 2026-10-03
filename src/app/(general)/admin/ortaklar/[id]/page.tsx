import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PartnerManage } from "@/components/admin/partner-manage";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getUserDataSummary } from "@/lib/sites/manage";
import { SITE_MEMBER_ROLE_LABELS, type SiteMemberRole } from "@/lib/sites/schemas";

export const metadata: Metadata = { title: "Ortak Detayı — ÖZN YOL" };

type PartnerDetail = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: "admin" | "partner";
  archived_at: string | null;
  must_change_password: boolean;
  site_members: { role: SiteMemberRole; archived_at: string | null; sites: { id: number; name: string; status: string } | null }[];
};

/** Admin: ortak hesabını görüntüler, düzenler, şifresini sıfırlar, arşive alır veya (verisi yoksa) siler. */
export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data }, summary] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email, phone, role, archived_at, must_change_password, site_members(role, archived_at, sites(id, name, status))")
      .eq("id", id)
      .maybeSingle(),
    getUserDataSummary(id),
  ]);
  const partner = data as PartnerDetail | null;
  if (!partner || partner.role !== "partner") notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/admin/ortaklar" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Ortaklar
      </Link>

      <div className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          {partner.full_name}
          {partner.archived_at && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Arşivde</span>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">{partner.email}</p>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Şantiyeler</h2>
        {partner.site_members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz hiçbir şantiyeye üye değil.</p>
        ) : (
          <ul className="divide-y">
            {partner.site_members.map((m, i) => (
              <li key={m.sites?.id ?? i} className="py-2.5">
                <p className="truncate text-sm font-medium">
                  {m.sites ? <Link href={`/admin/santiyeler/${m.sites.id}`} className="hover:underline">{m.sites.name}</Link> : "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {SITE_MEMBER_ROLE_LABELS[m.role]}
                  {m.sites?.status === "archived" && " · şantiye arşivde"}
                  {m.archived_at && " · üyelik arşivde"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PartnerManage
        userId={partner.id}
        fullName={partner.full_name}
        email={partner.email}
        phone={partner.phone ?? ""}
        archived={!!partner.archived_at}
        summary={summary}
      />
    </div>
  );
}
