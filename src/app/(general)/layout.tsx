import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleSites } from "@/lib/sites";

/** Şantiye seçilmeden önceki genel görünüm: admin paneli ve şantiye listesi. */
export default async function GeneralLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireUser();
  const sites = await getAccessibleSites();

  return (
    <AppShell user={{ fullName: profile.full_name, role: profile.role }} sites={sites}>
      {children}
    </AppShell>
  );
}
