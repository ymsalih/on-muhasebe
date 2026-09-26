import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PersonnelForm } from "@/components/personnel/personnel-form";
import { SensitiveField } from "@/components/personnel/sensitive-field";
import { PersonPayments, type PaymentRow } from "@/components/personnel/person-payments";
import { StatusBadge } from "@/components/personnel/status-badge";
import { requireUser } from "@/lib/auth/session";
import { formatCurrency, formatDate } from "@/lib/format";
import { listParties } from "@/lib/goods/queries";
import { listPersonPayments } from "@/lib/personnel/payments";
import { getPerson } from "@/lib/personnel/queries";
import { describeStatus, effectiveStatus, todayInIstanbul } from "@/lib/personnel/status";
import { canWriteRole, getSiteRole } from "@/lib/sites/queries";

export const metadata: Metadata = { title: "Personel Detayı — Şantiye Ön Muhasebe" };

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value || "—"}</dd>
    </div>
  );
}

export default async function PersonDetailPage({ params }: { params: Promise<{ siteId: string; personId: string }> }) {
  const { siteId: rawSite, personId: rawPerson } = await params;
  const siteId = Number(rawSite);
  const personId = Number(rawPerson);
  if (!Number.isInteger(siteId) || !Number.isInteger(personId)) notFound();

  const [profile, person, role, parties, paymentList] = await Promise.all([
    requireUser(),
    getPerson(siteId, personId),
    getSiteRole(siteId),
    listParties(siteId),
    listPersonPayments(siteId, personId),
  ]);
  if (!person) notFound();

  const canWrite = canWriteRole(role);
  const payments: PaymentRow[] = paymentList.map((p) => ({
    id: p.id,
    amount: p.amount,
    date: p.transaction_date,
    method: p.payment_method,
    workDays: p.work_days,
    dailyRate: p.daily_rate,
    periodMonth: p.period_month ? p.period_month.slice(0, 7) : null,
    description: p.description,
  }));
  const paymentsSection = (
    <PersonPayments
      siteId={siteId}
      personId={personId}
      personName={person.full_name}
      dailyWage={person.daily_wage === null ? null : Number(person.daily_wage)}
      payments={payments}
      canWrite={canWrite}
      today={todayInIstanbul()}
    />
  );
  const today = todayInIstanbul();
  const eff = effectiveStatus(person, today);
  const statusNote = describeStatus(eff);
  const back = (
    <Link href={`/sites/${siteId}/personel`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden />
      Personel
    </Link>
  );

  if (canWrite) {
    return (
      <div className="space-y-4">
        {back}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{person.full_name}</h1>
          <StatusBadge status={eff.status} />
        </div>
        {statusNote && <p className="text-sm text-muted-foreground">{statusNote}</p>}
        <PersonnelForm
          siteId={siteId}
          personId={person.id}
          parties={parties}
          hasTcNo={person.has_tc_no}
          hasIban={person.has_iban}
          canDelete={role === "owner"}
          today={today}
          initial={{
            fullName: person.full_name,
            tcNo: "",
            tcNoChanged: false, // mevcut TC forma yüklenmez; yalnızca "Değiştir" ile girilir
            employerPartyId: person.employer_party_id === null ? "" : String(person.employer_party_id),
            insuranceCompany: person.insurance_company ?? "",
            job: person.job ?? "",
            duty: person.duty ?? "",
            status: person.status === "ayrildi" ? "ayrildi" : "aktif", // izinli/raporlu/geçici görev tarihlerden türetilir
            hireDate: person.hire_date ?? "",
            terminationDate: person.termination_date ?? "",
            tempAssignmentStart: person.temp_assignment_start ?? "",
            reportStart: person.report_start ?? "",
            leaveStart: person.leave_start ?? "",
            absenceDaysCount: person.absence_days_count === null ? "" : String(person.absence_days_count),
            returnDate: person.return_date ?? "",
            iban: "",
            ibanChanged: false,
            phone: person.phone ?? "",
            dailyWage: person.daily_wage === null ? "" : String(person.daily_wage).replace(".", ","),
          }}
        />
        {paymentsSection}
      </div>
    );
  }

  // Salt görüntüleme (viewer / admin): düzenleme yok. Admin "Göster" ile hassas alanları açabilir; viewer açamaz.
  const canReveal = profile.role === "admin";
  return (
    <div className="max-w-2xl space-y-4">
      {back}
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">{person.full_name}</h1>
        <StatusBadge status={eff.status} />
      </div>
      {statusNote && <p className="text-sm text-muted-foreground">{statusNote}</p>}
      <p className="text-sm text-muted-foreground">Bu kaydı yalnızca görüntüleyebilirsiniz.</p>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Kimlik Bilgileri</h2>
        <SensitiveField id="tcNo" label="TC kimlik no" kind="tcNo" personId={person.id} hasValue={person.has_tc_no} canReveal={canReveal} readOnly />
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">İstihdam Bilgileri</h2>
        <dl className="divide-y">
          <Item label="Çalıştığı firma" value={person.parties?.name} />
          <Item label="Sigortayı yapan firma" value={person.insurance_company} />
          <Item label="İşi" value={person.job} />
          <Item label="Görevi" value={person.duty} />
          <Item label="İşe giriş" value={person.hire_date && formatDate(person.hire_date)} />
          <Item label="İşten çıkış" value={person.termination_date && formatDate(person.termination_date)} />
        </dl>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Durum / İzin Bilgileri</h2>
        <dl className="divide-y">
          <Item label="Geçici görev başlangıcı" value={person.temp_assignment_start && formatDate(person.temp_assignment_start)} />
          <Item label="Rapor başlangıcı" value={person.report_start && formatDate(person.report_start)} />
          <Item label="İzin başlangıcı" value={person.leave_start && formatDate(person.leave_start)} />
          <Item label="Gün sayısı" value={person.absence_days_count} />
          <Item label="İşe dönüş" value={person.return_date && formatDate(person.return_date)} />
        </dl>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Ödeme Bilgileri</h2>
        <SensitiveField id="iban" label="IBAN" kind="iban" personId={person.id} hasValue={person.has_iban} canReveal={canReveal} readOnly />
        <dl>
          <Item label="Telefon" value={person.phone} />
          <Item label="Günlük ücret" value={person.daily_wage !== null && formatCurrency(Number(person.daily_wage))} />
        </dl>
      </section>
      {paymentsSection}
    </div>
  );
}
