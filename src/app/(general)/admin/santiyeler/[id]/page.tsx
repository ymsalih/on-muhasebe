import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { SiteMembersManager, type MemberRow } from "@/components/admin/site-members-manager";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Şantiye Detayı — Şantiye Ön Muhasebe" };

type SiteDetail = {
  id: number;
  name: string;
  address: string | null;
  start_date: string | null;
  status: "active" | "closed";
  site_members: {
    id: number;
    role: MemberRow["role"];
    share_percentage: number | null;
    users: { id: string; full_name: string; email: string } | null;
  }[];
};

export default async function AdminSiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId)) notFound();

  const supabase = await createClient();
  const [{ data: siteData }, { data: partnerData }] = await Promise.all([
    supabase
      .from("sites")
      .select("id, name, address, start_date, status, site_members(id, role, share_percentage, users(id, full_name, email))")
      .eq("id", siteId)
      .maybeSingle(),
    supabase.from("users").select("id, full_name").eq("role", "partner").order("full_name"),
  ]);

  const site = siteData as SiteDetail | null;
  if (!site) notFound();

  const memberIds = new Set(site.site_members.map((m) => m.users?.id));
  const members: MemberRow[] = site.site_members
    .filter((m) => m.users)
    .map((m) => ({
      id: m.id,
      fullName: m.users!.full_name,
      email: m.users!.email,
      role: m.role,
      sharePercentage: m.share_percentage === null ? null : Number(m.share_percentage),
    }));
  const available = (partnerData ?? [])
    .filter((p) => !memberIds.has(p.id as string))
    .map((p) => ({ id: p.id as string, fullName: p.full_name as string }));

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/admin/santiyeler" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Şantiyeler
      </Link>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{site.name}</h1>
        <p className="text-sm text-muted-foreground">
          {site.address ?? "Adres girilmedi"}
          {site.start_date && ` · Başlangıç: ${formatDate(site.start_date)}`}
        </p>
        <Link
          href={`/sites/${site.id}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Şantiye paneline git
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      </div>

      <SiteMembersManager siteId={site.id} status={site.status} members={members} available={available} />
    </div>
  );
}
