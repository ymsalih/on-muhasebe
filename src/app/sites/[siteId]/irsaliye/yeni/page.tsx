import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { GoodsEntryForm } from "@/components/goods/goods-entry-form";
import { requireUser } from "@/lib/auth/session";
import { getSuggestions, listParties } from "@/lib/goods/queries";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";

export const metadata: Metadata = { title: "Yeni İrsaliye — ÖZN YOL" };

export default async function NewGoodsEntryPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const [, role, parties, suggestions] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    listParties(siteId),
    getSuggestions(siteId),
  ]);
  if (!canWriteRole(role)) redirect(`/sites/${siteId}/irsaliye`); // viewer ve admin kayıt ekleyemez
  // Sunucu saat diliminden bağımsız olarak Türkiye'nin bugünü (yyyy-mm-dd)
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

  return (
    <div className="space-y-4">
      <Link
        href={`/sites/${siteId}/irsaliye`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        İrsaliye / Fatura
      </Link>
      <h1 className="text-xl font-semibold">Yeni Kayıt</h1>
      <GoodsEntryForm
        siteId={siteId}
        parties={parties}
        suggestions={suggestions}
        initial={{
          entryDate: today,
          documentType: "irsaliye",
          documentNo: "",
          partyId: "",
          materialType: "",
          unit: "",
          variant: "",
          quantity: "",
          unitPrice: "",
          usedLocation: "",
          purchaseLocation: "",
          transportCost: "",
          info: "",
        }}
      />
    </div>
  );
}
