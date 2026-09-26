import type { Metadata } from "next";
import Link from "next/link";
import { Phone, Plus, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ortaklar — Şantiye Ön Muhasebe" };

type PartnerRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  must_change_password: boolean;
  site_members: { sites: { id: number; name: string } | null }[];
};

export default async function PartnersPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase
    .from("users")
    .select("id, full_name, email, phone, must_change_password, site_members(sites(id, name))")
    .eq("role", "partner")
    .order("full_name");
  const partners = (data as PartnerRow[] | null) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Ortaklar</h1>
        <Link
          href="/admin/ortaklar/yeni"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" aria-hidden />
          Yeni Ortak
        </Link>
      </div>

      {partners.length === 0 ? (
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
          <Users className="size-10 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">Henüz ortak eklenmedi</h2>
          <p className="text-sm text-muted-foreground">Ortak eklediğinizde giriş bilgileri burada listelenir.</p>
          <Link
            href="/admin/ortaklar/yeni"
            className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" aria-hidden />
            İlk ortağı ekle
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 md:max-w-3xl">
          {partners.map((p) => {
            const siteNames = p.site_members.map((m) => m.sites?.name).filter(Boolean) as string[];
            return (
              <li key={p.id} className="space-y-2 rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.full_name}</p>
                    <p className="truncate text-sm text-muted-foreground">{p.email}</p>
                  </div>
                  {p.must_change_password && (
                    <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-400">
                      İlk giriş bekliyor
                    </span>
                  )}
                </div>
                {p.phone && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Phone className="size-3.5" aria-hidden />
                    {p.phone}
                  </p>
                )}
                <p className="text-sm">
                  <span className="text-muted-foreground">Şantiyeler: </span>
                  {siteNames.length > 0 ? siteNames.join(", ") : <span className="text-muted-foreground">atanmadı</span>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
