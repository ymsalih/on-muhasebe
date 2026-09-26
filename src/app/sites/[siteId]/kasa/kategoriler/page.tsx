import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CategoryManager } from "@/components/cash/category-manager";
import { requireUser } from "@/lib/auth/session";
import { listCategories } from "@/lib/cash/queries";
import { createClient } from "@/lib/supabase/server";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";

export const metadata: Metadata = { title: "Kategoriler — Şantiye Ön Muhasebe" };

export default async function CategoriesPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const supabase = await createClient();
  const [, role, categories, { data: used }] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    listCategories(siteId),
    // Hangi kategori kaç hareketle kullanılıyor (silme uyarısı ve bilgi için)
    supabase.from("transactions").select("category_id").eq("site_id", siteId).not("category_id", "is", null).limit(5000),
  ]);

  const usage: Record<number, number> = {};
  for (const r of used ?? []) usage[r.category_id as number] = (usage[r.category_id as number] ?? 0) + 1;

  return (
    <div className="max-w-2xl space-y-4">
      <Link href={`/sites/${siteId}/kasa`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Genel Kasa
      </Link>
      <h1 className="text-xl font-semibold">Kategoriler</h1>
      <p className="text-sm text-muted-foreground">
        Varsayılan kategoriler tüm şantiyelerde vardır ve değiştirilemez. Burada yalnızca bu şantiyeye özel kategoriler ekleyebilir, adlarını değiştirebilir veya (hareketi yoksa) silebilirsiniz.
      </p>
      <CategoryManager siteId={siteId} categories={categories} canWrite={canWriteRole(role)} usage={usage} />
    </div>
  );
}
