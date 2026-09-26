import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteForm } from "@/components/admin/site-form";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Yeni Şantiye — Şantiye Ön Muhasebe" };

export default async function NewSitePage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data } = await supabase.from("users").select("id, full_name, email").eq("role", "partner").order("full_name");
  const partners = (data ?? []).map((u) => ({ id: u.id as string, fullName: u.full_name as string, email: u.email as string }));

  return (
    <div className="space-y-4">
      <Link href="/admin/santiyeler" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Şantiyeler
      </Link>
      <h1 className="text-xl font-semibold">Yeni Şantiye Ekle</h1>
      <SiteForm partners={partners} />
    </div>
  );
}
