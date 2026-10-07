import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getChequeAlerts } from "@/lib/cheques/queries";
import { getAccessibleSites, getSiteAccess } from "@/lib/sites/queries";

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

  const [profile, sites, access, chequeAlerts] = await Promise.all([requireUser(), getAccessibleSites(), getSiteAccess(id), getChequeAlerts(id)]);
  const site = sites.find((s) => s.id === id);
  if (!site) notFound();

  // Menüdeki çek rozeti: vadesi yaklaşan + geçmiş bekleyen çek sayısı (kırmızı = vadesi geçmiş var)
  const chequeAlert = chequeAlerts.length > 0 ? { count: chequeAlerts.length, danger: chequeAlerts.some((a) => a.daysLeft < 0) } : undefined;

  const notice =
    site.status === "archived"
      ? {
          text: "Bu şantiye arşivde: veriler korunur ve görüntülenebilir, ancak veri eklenemez veya değiştirilemez.",
          ...(access.role === "owner" ? { href: `/sites/${id}/ayarlar`, linkLabel: "Arşivden çıkar" } : {}),
        }
      : access.memberArchived
        ? { text: "Bu şantiyedeki üyeliğiniz arşivde: yalnızca kendi verilerinizi görüntüleyebilirsiniz, veri ekleyemezsiniz." }
        : undefined;

  return (
    <AppShell user={{ fullName: profile.full_name, role: profile.role }} site={site} sites={sites} notice={notice} chequeAlert={chequeAlert}>
      {children}
    </AppShell>
  );
}
