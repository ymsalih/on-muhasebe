import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleSites } from "@/lib/sites/queries";

/**
 * Şantiye paneli. Erişim RLS ile belirlenir: kullanıcının göremediği bir şantiye
 * "erişilebilir şantiyeler" listesinde yoktur, bu yüzden 404 döner (varlığı sızdırılmaz).
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const id = Number(siteId);
  if (!Number.isInteger(id)) notFound();

  const [profile, sites] = await Promise.all([requireUser(), getAccessibleSites()]);
  const site = sites.find((s) => s.id === id);
  if (!site) notFound();

  return (
    <AppShell user={{ fullName: profile.full_name, role: profile.role }} site={site} sites={sites}>
      {children}
    </AppShell>
  );
}
