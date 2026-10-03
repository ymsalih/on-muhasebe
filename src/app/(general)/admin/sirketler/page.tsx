import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { DataRow } from "@/components/data-row";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Şirket Kasaları — ÖZN YOL" };

/** Admin: ortakların şirket kasalarını SALT OKUR (kayıt ekleyemez/değiştiremez). */
export default async function CompaniesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from("users").select("id, full_name, email").eq("role", "partner").order("full_name");
  const partners = (data as { id: string; full_name: string; email: string }[] | null) ?? [];

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Landmark className="size-5 text-muted-foreground" aria-hidden />
        Şirket Kasaları
      </h1>
      <p className="text-sm text-muted-foreground">Her ortağın kendi şirket kasası ayrıdır. Burada salt görüntüleme yapabilirsiniz.</p>
      {partners.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Henüz ortak yok.</p>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {partners.map((p) => (
            <DataRow key={p.id} href={`/admin/sirketler/${p.id}`} title={p.full_name} lines={[p.email]} />
          ))}
        </div>
      )}
    </div>
  );
}
