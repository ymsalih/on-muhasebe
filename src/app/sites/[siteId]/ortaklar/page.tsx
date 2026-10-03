import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SitePartners, type MemberRow } from "@/components/sites/site-partners";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getMemberDataTotals } from "@/lib/sites/manage";
import { getSiteAccess } from "@/lib/sites/queries";
import type { SiteMemberRole } from "@/lib/sites/schemas";

export const metadata: Metadata = { title: "Şantiye Ortakları — ÖZN YOL" };

type Row = {
  id: number;
  user_id: string;
  role: SiteMemberRole;
  archived_at: string | null;
  users: { full_name: string; email: string } | null;
};

/**
 * "Şantiye Ortakları" (CLAUDE.md 7.3-B2): ortağın kendi şantiye panelindeki ekran.
 * Sahip (owner) hesabı olan bir ortağı arayıp şantiyeye ekler. Diğer üyeler yalnızca kendi üyeliklerini görür (RLS).
 */
export default async function SitePartnersPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const supabase = await createClient();
  const [profile, access, { data }] = await Promise.all([
    requireUser(),
    getSiteAccess(siteId),
    supabase
      .from("site_members")
      .select("id, user_id, role, archived_at, users(full_name, email)")
      .eq("site_id", siteId)
      .order("joined_at"),
  ]);
  const rows = (data as Row[] | null) ?? [];

  const isOwner = access.role === "owner" && !access.memberArchived;
  // Çıkar / arşive al kararı için üye başına veri sayısı (yalnızca sahip için)
  const totals = isOwner ? await getMemberDataTotals(siteId) : {};

  const members: MemberRow[] = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    fullName: r.users?.full_name ?? "—",
    email: r.users?.email ?? "",
    role: r.role,
    archived: !!r.archived_at,
    dataCount: totals[r.user_id] ?? 0,
  }));

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Şantiye Ortakları</h1>
        <p className="text-sm text-muted-foreground">Bu şantiyede birlikte çalışan ortaklar.</p>
      </div>
      <SitePartners siteId={siteId} isOwner={isOwner} currentUserId={profile.id} members={members} />
    </div>
  );
}
