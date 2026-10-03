import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { CompanyView } from "@/components/company/company-view";
import { requireUser } from "@/lib/auth/session";
import { resolvePeriod } from "@/lib/company/period";
import { getCompanySummary, listCompanyEntries } from "@/lib/company/queries";
import { todayInIstanbul } from "@/lib/personnel/status";

export const metadata: Metadata = { title: "Şirket Kasası — Şantiye Ön Muhasebe" };

/** Şirket Kasası: ortağın kendi şirketinin genel gelir/gideri ve dönem kâr/zararı. Şantiyeden bağımsızdır; her ortak yalnızca kendininkini görür. */
export default async function CompanyPage({ searchParams }: { searchParams: Promise<{ gorunum?: string; tarih?: string; yil?: string }> }) {
  const sp = await searchParams;
  const profile = await requireUser();
  if (profile.role === "admin") redirect("/admin/sirketler");

  const today = todayInIstanbul();
  const period = resolvePeriod(sp.gorunum, sp.gorunum === "yil" ? sp.yil : sp.tarih, today);
  const [summary, list] = await Promise.all([
    getCompanySummary(profile.id, period.from, period.to),
    listCompanyEntries(profile.id, period.from, period.to),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Landmark className="size-5 text-muted-foreground" aria-hidden />
        Şirket Kasası
      </h1>
      <CompanyView base="/sirket" period={period} summary={summary} rows={list.rows} hasMore={list.hasMore} canWrite today={today} />
    </div>
  );
}
