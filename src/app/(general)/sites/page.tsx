import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleSites } from "@/lib/sites";

export const metadata: Metadata = { title: "Şantiyeler — Şantiye Ön Muhasebe" };

/** Şantiye listesi (Faz 1 iskeleti). Kartlardaki özet ve "Yeni Şantiye Ekle" Faz 2'de eklenecek. */
export default async function SitesPage() {
  await requireUser();
  const sites = await getAccessibleSites();

  if (sites.length === 0) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center">
        <Building2 className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-semibold">Henüz erişebildiğiniz bir şantiye yok</h2>
        <p className="text-sm text-muted-foreground">Yöneticiniz sizi bir şantiyeye eklediğinde burada görünecek.</p>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 md:max-w-2xl">
      {sites.map((site) => (
        <li key={site.id}>
          <Link
            href={`/sites/${site.id}`}
            className="flex min-h-16 items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/50"
          >
            <Building2 className="size-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{site.name}</span>
              <span className="text-xs text-muted-foreground">{site.status === "active" ? "Aktif" : "Kapalı"}</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
