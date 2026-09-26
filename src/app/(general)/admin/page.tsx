import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ChevronRight, Plus, UserPlus, Users } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin Paneli — Şantiye Ön Muhasebe" };

/** Admin genel görünümü: tüm ortaklar ve şantiyeler (CLAUDE.md Bölüm 5, "Admin paneli"). */
export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ count: siteCount }, { count: partnerCount }] = await Promise.all([
    supabase.from("sites").select("*", { count: "exact", head: true }),
    supabase.from("users").select("*", { count: "exact", head: true }).eq("role", "partner"),
  ]);

  const tiles = [
    { href: "/admin/santiyeler", label: "Şantiye", count: siteCount ?? 0, icon: Building2, addHref: "/admin/santiyeler/yeni", addLabel: "Yeni Şantiye" },
    { href: "/admin/ortaklar", label: "Ortak", count: partnerCount ?? 0, icon: Users, addHref: "/admin/ortaklar/yeni", addLabel: "Yeni Ortak" },
  ];

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Genel Bakış</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map(({ href, label, count, icon: Icon, addHref, addLabel }) => (
          <div key={href} className="space-y-3 rounded-xl border bg-card p-4">
            <Link href={href} className="flex min-h-11 items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block text-2xl font-semibold leading-tight">{count}</span>
                <span className="text-sm text-muted-foreground">{label}</span>
              </span>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
            </Link>
            <Link
              href={addHref}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium hover:bg-muted"
            >
              {label === "Ortak" ? <UserPlus className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              {addLabel}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
