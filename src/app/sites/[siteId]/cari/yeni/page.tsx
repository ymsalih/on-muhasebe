import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PartyForm } from "@/components/parties/party-form";
import { requireUser } from "@/lib/auth/session";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";

export const metadata: Metadata = { title: "Yeni Cari — Şantiye Ön Muhasebe" };

export default async function NewPartyPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const [, role] = await Promise.all([requireUser(), getSiteRole(siteId)]);
  if (!canWriteRole(role)) redirect(`/sites/${siteId}/cari`); // viewer ve admin cari ekleyemez

  return (
    <div className="space-y-4">
      <Link href={`/sites/${siteId}/cari`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Cari Hesaplar
      </Link>
      <h1 className="text-xl font-semibold">Yeni Cari</h1>
      <PartyForm siteId={siteId} canDelete={false} initial={{ name: "", category: "firma", phone: "", address: "", notes: "" }} />
    </div>
  );
}
