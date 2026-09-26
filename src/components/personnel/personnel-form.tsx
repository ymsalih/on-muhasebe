"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { PartyPicker } from "@/components/party-picker";
import { StickyActionBar } from "@/components/layout/sticky-action-bar";
import { SensitiveField } from "@/components/personnel/sensitive-field";
import type { PartyOption } from "@/lib/goods/actions";
import { deletePersonnel, savePersonnel } from "@/lib/personnel/actions";
import { BASE_STATUSES, PERSON_STATUS_LABELS, personnelSchema, type PersonnelValues } from "@/lib/personnel/schemas";
import { StatusBadge } from "@/components/personnel/status-badge";
import { daysBetween, describeStatus, effectiveStatus, latestAbsenceStart } from "@/lib/personnel/status";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const groupClass = "space-y-4 rounded-xl border bg-card p-4";

/**
 * Personel ekleme/düzenleme (CLAUDE.md 7.3-H): 16 alan dört grupta. Hassas alanlar (TC no, IBAN) forma
 * mevcut değerleriyle YÜKLENMEZ; yalnızca "dolu mu" bilgisi gelir (hasTcNo / hasIban).
 */
export function PersonnelForm({
  siteId,
  personId,
  initial,
  hasTcNo,
  hasIban,
  parties: initialParties,
  canDelete,
  today,
}: {
  siteId: number;
  personId?: number;
  initial: PersonnelValues;
  hasTcNo: boolean;
  hasIban: boolean;
  parties: PartyOption[];
  canDelete: boolean;
  /** Türkiye'nin bugünü (yyyy-mm-dd); güncel durum önizlemesi için. */
  today: string;
}) {
  const router = useRouter();
  const listHref = `/sites/${siteId}/personel`;
  const isEdit = personId !== undefined;

  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [parties, setParties] = useState(initialParties);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PersonnelValues>({ resolver: zodResolver(personnelSchema), defaultValues: initial });

  // Kaydetmeden önce, girilen tarihlere göre kişinin bugünkü durumunu canlı göster.
  const w = watch();
  const eff = effectiveStatus(
    {
      status: w.status,
      termination_date: w.terminationDate || null,
      temp_assignment_start: w.tempAssignmentStart || null,
      report_start: w.reportStart || null,
      leave_start: w.leaveStart || null,
      return_date: w.returnDate || null,
      absence_days_count: /^\d+$/.test(w.absenceDaysCount) ? Number(w.absenceDaysCount) : null,
    },
    today,
  );
  const statusNote = describeStatus(eff);
  const startForDays = latestAbsenceStart({
    temp_assignment_start: w.tempAssignmentStart || null,
    report_start: w.reportStart || null,
    leave_start: w.leaveStart || null,
  });
  const autoDays =
    w.absenceDaysCount === "" && startForDays && w.returnDate && w.returnDate > startForDays
      ? daysBetween(startForDays, w.returnDate)
      : null;

  async function onSubmit(values: PersonnelValues) {
    setFormError(null);
    const result = await savePersonnel(siteId, personId ?? null, values).catch(() => null);
    if (!result) return setFormError("Kayıt eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!result.ok) return setFormError(result.error);
    router.replace(listHref);
    router.refresh();
  }

  async function onDelete() {
    if (personId === undefined) return;
    if (
      !window.confirm(
        "Bu personel kalıcı olarak silinsin mi? Puantaj geçmişi de silinir. Çalışan işten ayrıldıysa silmek yerine durumunu 'Ayrıldı' yapın.",
      )
    )
      return;
    setDeleting(true);
    setFormError(null);
    const result = await deletePersonnel(siteId, personId).catch(() => null);
    setDeleting(false);
    if (!result) return setFormError("Personel silinemedi, bağlantınızı kontrol edip tekrar deneyin.");
    if (!result.ok) return setFormError(result.error);
    router.replace(listHref);
    router.refresh();
  }

  const text = (id: keyof PersonnelValues, label: string, opts?: { type?: string; inputMode?: "numeric" | "tel" | "text" | "decimal" }) => (
    <Field id={id} label={label} error={errors[id]?.message as string | undefined}>
      <Input
        id={id}
        type={opts?.type}
        inputMode={opts?.inputMode}
        autoComplete="off"
        className="h-11"
        aria-invalid={!!errors[id]}
        {...register(id as never)}
      />
    </Field>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-4 pb-28 md:pb-0" noValidate>
      <FormError message={formError} />

      <fieldset className={groupClass}>
        <legend className="px-1 text-sm font-semibold">Kimlik Bilgileri</legend>
        {text("fullName", "Ad soyad")}
        <SensitiveField
          id="tcNo"
          label="TC kimlik no"
          kind="tcNo"
          personId={personId}
          hasValue={hasTcNo}
          canReveal
          value={watch("tcNo")}
          onChange={(v, changed) => {
            setValue("tcNo", v, { shouldDirty: true, shouldValidate: changed });
            setValue("tcNoChanged", changed);
          }}
          error={errors.tcNo?.message}
          inputMode="numeric"
          maxLength={11}
        />
      </fieldset>

      <fieldset className={groupClass}>
        <legend className="px-1 text-sm font-semibold">İstihdam Bilgileri</legend>
        <PartyPicker
          id="employerPartyId"
          label="Çalıştığı firma"
          siteId={siteId}
          parties={parties}
          onPartiesChange={setParties}
          value={watch("employerPartyId")}
          onChange={(v) => setValue("employerPartyId", v, { shouldDirty: true })}
          error={errors.employerPartyId?.message}
        />
        {text("insuranceCompany", "Sigortayı yapan firma")}
        {text("job", "İşi")}
        {text("duty", "Görevi")}
        <div className="grid grid-cols-2 gap-3">
          {text("hireDate", "İşe giriş tarihi", { type: "date" })}
          {text("terminationDate", "İşten çıkış tarihi", { type: "date" })}
        </div>
      </fieldset>

      <fieldset className={groupClass}>
        <legend className="px-1 text-sm font-semibold">Durum / İzin Bilgileri</legend>
        <Field id="status" label="Çalışma durumu" error={errors.status?.message}>
          <select id="status" className={selectClass} {...register("status")}>
            {BASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PERSON_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <p className="-mt-2 text-xs text-muted-foreground">
          İzinli, Raporlu ve Geçici Görevde durumları aşağıdaki tarihlerden otomatik belirlenir.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {text("tempAssignmentStart", "Geçici görev başlangıcı", { type: "date" })}
          {text("reportStart", "Rapor başlangıcı", { type: "date" })}
          {text("leaveStart", "İzin başlangıcı", { type: "date" })}
          {text("returnDate", "İşe dönüş tarihi", { type: "date" })}
        </div>
        {text("absenceDaysCount", "Geçici görev / rapor / izin gün sayısı", { inputMode: "numeric" })}
        {autoDays !== null && (
          <p className="-mt-2 text-xs text-muted-foreground">Boş bırakırsanız {autoDays} gün olarak hesaplanır.</p>
        )}

        <div className="space-y-2 rounded-lg bg-muted/50 p-3" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-medium">
            Bugünkü durum: <StatusBadge status={eff.status} />
          </div>
          {statusNote && <p className="text-sm text-muted-foreground">{statusNote}</p>}
        </div>
      </fieldset>

      <fieldset className={groupClass}>
        <legend className="px-1 text-sm font-semibold">Ödeme Bilgileri</legend>
        <SensitiveField
          id="iban"
          label="IBAN"
          kind="iban"
          personId={personId}
          hasValue={hasIban}
          canReveal
          value={watch("iban")}
          onChange={(v, changed) => {
            setValue("iban", v, { shouldDirty: true, shouldValidate: changed });
            setValue("ibanChanged", changed);
          }}
          error={errors.iban?.message}
          maxLength={40}
        />
        {text("phone", "Telefon", { type: "tel", inputMode: "tel" })}
        {text("dailyWage", "Günlük ücret (₺)", { inputMode: "decimal" })}
      </fieldset>

      {isEdit && canDelete && (
        <Button type="button" variant="destructive" className="h-11 w-full" onClick={onDelete} disabled={deleting || isSubmitting}>
          {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
          Personeli Sil
        </Button>
      )}

      <StickyActionBar>
        <Link href={listHref} className="hidden h-12 items-center rounded-lg border px-5 text-sm font-medium hover:bg-muted md:inline-flex">
          İptal
        </Link>
        <Button type="submit" className="h-12 flex-1 text-base md:min-w-40 md:flex-none" disabled={isSubmitting || deleting}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          {isEdit ? "Değişiklikleri Kaydet" : "Personeli Ekle"}
        </Button>
      </StickyActionBar>
    </form>
  );
}
