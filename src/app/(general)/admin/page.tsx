import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronRight, UserPlus, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin Paneli — ÖZN YOL" };

/**
 * Admin genel görünümü (CLAUDE.md Bölüm 1): kullanıcı hesabı açma + tüm ortak/şantiyelerin salt görüntülenmesi.
 * Şantiye oluşturma ve üye atama burada YOKTUR; bunlar ortakların kendi panelindeki işlerdir.
 */
export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ count: siteCount }, { count: partnerCount }] = await Promise.all([
    supabase.from("sites").select("*", { count: "exact", head: true }),
    supabase.from("users").select("*", { count: "exact", head: true }).eq("role", "partner"),
  ]);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Genel Bakış</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <Link href="/admin/ortaklar" className="flex min-h-11 items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-2xl font-semibold leading-tight">{partnerCount ?? 0}</span>
              <span className="text-sm text-muted-foreground">Ortak</span>
            </span>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </Link>
          <Link
            href="/admin/ortaklar/yeni"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium hover:bg-muted"
          >
            <UserPlus className="size-4" aria-hidden />
            Yeni Ortak Ekle
          </Link>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <Link href="/admin/santiyeler" className="flex min-h-11 items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="size-5" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-2xl font-semibold leading-tight">{siteCount ?? 0}</span>
              <span className="text-sm text-muted-foreground">Şantiye (salt görüntüleme)</span>
            </span>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
