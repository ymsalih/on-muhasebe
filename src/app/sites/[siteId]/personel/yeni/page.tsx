import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PersonnelForm } from "@/components/personnel/personnel-form";
import { requireUser } from "@/lib/auth/session";
import { listParties } from "@/lib/goods/queries";
import { todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";

export const metadata: Metadata = { title: "Yeni Personel — Şantiye Ön Muhasebe" };

export default async function NewPersonPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: rawId } = await params;
  const siteId = Number(rawId);
  if (!Number.isInteger(siteId)) notFound();

  const [, role, parties] = await Promise.all([requireUser(), getSiteRole(siteId), listParties(siteId)]);
  if (!canWriteRole(role)) redirect(`/sites/${siteId}/personel`);

  return (
    <div className="space-y-4">
      <Link href={`/sites/${siteId}/personel`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Personel
      </Link>
      <h1 className="text-xl font-semibold">Yeni Personel</h1>
      <PersonnelForm
        siteId={siteId}
        parties={parties}
        hasTcNo={false}
        hasIban={false}
        canDelete={false}
        today={todayInIstanbul()}
        initial={{
          fullName: "",
          tcNo: "",
          tcNoChanged: true, // yeni kayıtta alan doğrudan düzenlenir
          employerPartyId: "",
          insuranceCompany: "",
          job: "",
          duty: "",
          status: "aktif",
          hireDate: "",
          terminationDate: "",
          tempAssignmentStart: "",
          reportStart: "",
          leaveStart: "",
          absenceDaysCount: "",
          returnDate: "",
          iban: "",
          ibanChanged: true,
          phone: "",
          dailyWage: "",
        }}
      />
    </div>
  );
}
