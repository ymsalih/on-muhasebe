import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PartnerForm } from "@/components/admin/partner-form";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Yeni Ortak — Şantiye Ön Muhasebe" };

export default async function NewPartnerPage() {
  await requireAdmin();

  return (
    <div className="space-y-4">
      <Link href="/admin/ortaklar" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Ortaklar
      </Link>
      <h1 className="text-xl font-semibold">Yeni Ortak Ekle</h1>
      <PartnerForm />
    </div>
  );
}
