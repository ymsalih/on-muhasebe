import type { Metadata } from "next";
import { Building2, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin Paneli — Şantiye Ön Muhasebe" };

/** Admin paneli iskeleti (Faz 1). Ortak/şantiye ekleme akışı Faz 2'de eklenecek. */
export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ count: siteCount }, { count: userCount }] = await Promise.all([
    supabase.from("sites").select("*", { count: "exact", head: true }),
    supabase.from("users").select("*", { count: "exact", head: true }),
  ]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:max-w-xl">
        <div className="rounded-xl border bg-card p-4">
          <Building2 className="mb-2 size-5 text-muted-foreground" aria-hidden />
          <p className="text-2xl font-semibold">{siteCount ?? 0}</p>
          <p className="text-sm text-muted-foreground">Şantiye</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <Users className="mb-2 size-5 text-muted-foreground" aria-hidden />
          <p className="text-2xl font-semibold">{userCount ?? 0}</p>
          <p className="text-sm text-muted-foreground">Kullanıcı</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Yeni ortak ve şantiye ekleme ekranları bir sonraki fazda burada olacak.
      </p>
    </div>
  );
}
