import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteManage } from "@/components/sites/site-manage";
import { requireUser } from "@/lib/auth/session";
import { getSiteDataSummary } from "@/lib/sites/manage";
import { getSiteAccess } from "@/lib/sites/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Şantiye Ayarları — ÖZN YOL" };

/** Şantiye ayarları: düzenle / arşive al / sil. Yalnızca şantiyenin sahibi (admin kendi panelinden yönetir). */
export default async function SiteSettingsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const supabase = await createClient();
  const [, access, { data: site }] = await Promise.all([
    requireUser(),
    getSiteAccess(siteId),
    supabase.from("sites").select("name, address, start_date, status").eq("id", siteId).maybeSingle(),
  ]);
  if (!site) notFound();

  if (access.role !== "owner") {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-xl font-semibold">Şantiye Ayarları</h1>
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Şantiyeyi yalnızca sahibi düzenleyebilir, arşive alabilir veya silebilir.
        </p>
      </div>
    );
  }

  const summary = await getSiteDataSummary(siteId);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Şantiye Ayarları</h1>
        <p className="text-sm text-muted-foreground">Bilgileri düzenleyin; şantiye bitince silmek yerine arşive alın.</p>
      </div>
      <SiteManage
        siteId={siteId}
        initial={{ name: site.name, address: site.address ?? "", startDate: site.start_date ?? "" }}
        status={site.status as "active" | "closed" | "archived"}
        summary={summary}
        afterDeleteHref="/sites"
      />
    </div>
  );
}
