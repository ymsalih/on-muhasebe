import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CompanyView } from "@/components/company/company-view";
import { requireAdmin } from "@/lib/auth/session";
import { resolvePeriod } from "@/lib/company/period";
import { getCompanySummary, listCompanyEntries } from "@/lib/company/queries";
import { todayInIstanbul } from "@/lib/personnel/status";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Şirket Kasası — Şantiye Ön Muhasebe" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ gorunum?: string; tarih?: string; yil?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  await requireAdmin();

  const supabase = await createClient();
  const today = todayInIstanbul();
  const period = resolvePeriod(sp.gorunum, sp.gorunum === "yil" ? sp.yil : sp.tarih, today);
  const [{ data: owner }, summary, list] = await Promise.all([
    supabase.from("users").select("full_name").eq("id", id).eq("role", "partner").maybeSingle(),
    getCompanySummary(id, period.from, period.to),
    listCompanyEntries(id, period.from, period.to),
  ]);
  if (!owner) notFound();

  return (
    <div className="space-y-4">
      <Link href="/admin/sirketler" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Şirket Kasaları
      </Link>
      <h1 className="text-xl font-semibold">{owner.full_name} — Şirket Kasası</h1>
      <p className="text-sm text-muted-foreground">Salt görüntüleme.</p>
      <CompanyView base={`/admin/sirketler/${id}`} period={period} summary={summary} rows={list.rows} hasMore={list.hasMore} canWrite={false} today={today} />
    </div>
  );
}
