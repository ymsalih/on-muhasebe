import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { GoodsEntryForm } from "@/components/goods/goods-entry-form";
import { requireUser } from "@/lib/auth/session";
import { getEntry, getSuggestions, listParties } from "@/lib/goods/queries";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";

export const metadata: Metadata = { title: "Kaydı Düzenle — Şantiye Ön Muhasebe" };

export default async function EditGoodsEntryPage({ params }: { params: Promise<{ siteId: string; entryId: string }> }) {
  const { siteId: rawSite, entryId: rawEntry } = await params;
  const siteId = Number(rawSite);
  const entryId = Number(rawEntry);
  if (!Number.isInteger(siteId) || !Number.isInteger(entryId)) notFound();

  const [, role, entry, parties, suggestions] = await Promise.all([
    requireUser(),
    getSiteRole(siteId),
    getEntry(siteId, entryId),
    listParties(siteId),
    getSuggestions(siteId),
  ]);
  if (!canWriteRole(role)) redirect(`/sites/${siteId}/irsaliye`);
  if (!entry) notFound();

  const numText = (n: number | null) => (n === null ? "" : String(Number(n)));

  return (
    <div className="space-y-4">
      <Link
        href={`/sites/${siteId}/irsaliye`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        İrsaliye / Fatura
      </Link>
      <h1 className="text-xl font-semibold">Kaydı Düzenle</h1>
      <GoodsEntryForm
        siteId={siteId}
        entryId={entry.id}
        parties={parties}
        suggestions={suggestions}
        initial={{
          entryDate: entry.entry_date,
          documentType: entry.document_type,
          documentNo: entry.document_no ?? "",
          partyId: entry.party_id === null ? "" : String(entry.party_id),
          materialType: entry.material_type ?? "",
          unit: entry.unit ?? "",
          variant: entry.variant ?? "",
          quantity: numText(entry.quantity),
          unitPrice: numText(entry.unit_price),
          usedLocation: entry.used_location ?? "",
          purchaseLocation: entry.purchase_location ?? "",
          transportCost: Number(entry.transport_cost) === 0 ? "" : numText(entry.transport_cost),
          info: entry.info ?? "",
        }}
      />
    </div>
  );
}
