import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PartyForm } from "@/components/parties/party-form";
import { requireUser } from "@/lib/auth/session";
import { getParty } from "@/lib/parties/queries";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";

export const metadata: Metadata = { title: "Cariyi Düzenle — Şantiye Ön Muhasebe" };

export default async function EditPartyPage({ params }: { params: Promise<{ siteId: string; partyId: string }> }) {
  const { siteId: rawSite, partyId: rawParty } = await params;
  const siteId = Number(rawSite);
  const partyId = Number(rawParty);
  if (!Number.isInteger(siteId) || !Number.isInteger(partyId)) notFound();

  const [, role, party] = await Promise.all([requireUser(), getSiteRole(siteId), getParty(siteId, partyId)]);
  if (!canWriteRole(role)) redirect(`/sites/${siteId}/cari/${partyId}`);
  if (!party) notFound();

  return (
    <div className="space-y-4">
      <Link href={`/sites/${siteId}/cari/${partyId}`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {party.name}
      </Link>
      <h1 className="text-xl font-semibold">Cariyi Düzenle</h1>
      <PartyForm
        siteId={siteId}
        partyId={partyId}
        canDelete
        initial={{
          name: party.name,
          category: party.category,
          phone: party.phone ?? "",
          address: party.address ?? "",
          notes: party.notes ?? "",
        }}
      />
    </div>
  );
}
