import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { NewSiteForm } from "@/components/sites/new-site-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Yeni Şantiye — Şantiye Ön Muhasebe" };

/** Her ortağın kendi panelinden şantiye oluşturduğu ekran (7.3-B). Admin şantiye oluşturamaz. */
export default async function NewSitePage() {
  const profile = await requireUser();
  if (profile.role === "admin") redirect("/admin");

  return (
    <div className="space-y-4">
      <Link href="/sites" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Şantiyeler
      </Link>
      <h1 className="text-xl font-semibold">Yeni Şantiye Ekle</h1>
      <NewSiteForm />
    </div>
  );
}
