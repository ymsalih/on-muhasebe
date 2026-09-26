"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { normalizeIban, personnelSchema, type PersonnelValues } from "@/lib/personnel/schemas";
import { daysBetween } from "@/lib/personnel/status";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede personel kaydı ekleme/düzenleme yetkiniz yok.";

function mapError(error: { code?: string }): string {
  switch (error.code) {
    case "42501":
      return NO_WRITE_ERROR;
    case "23505":
      return "Bu TC kimlik numarasıyla kayıtlı bir personel zaten var.";
    case "23503":
      return "Seçilen firma bu şantiyeye ait değil.";
    case "23514":
      return "Girilen bilgilerden biri geçersiz (tarih sırası, gün sayısı, TC veya IBAN biçimi).";
    default:
      return GENERIC_ERROR;
  }
}

function toRow(v: PersonnelValues) {
  // Gün sayısı boş bırakıldıysa tarihlerden hesaplanır (en geç başlangıç → işe dönüş).
  const latestStart = [v.leaveStart, v.reportStart, v.tempAssignmentStart].filter(Boolean).sort().at(-1);
  const absenceDays =
    v.absenceDaysCount !== ""
      ? Number(v.absenceDaysCount)
      : latestStart && v.returnDate
        ? daysBetween(latestStart, v.returnDate)
        : null;

  const row: Record<string, string | number | null> = {
    full_name: v.fullName,
    employer_party_id: v.employerPartyId ? Number(v.employerPartyId) : null,
    insurance_company: v.insuranceCompany || null,
    job: v.job || null,
    duty: v.duty || null,
    // Yalnızca 'aktif' / 'ayrildi' saklanır; izinli/raporlu/geçici görev tarihlerden türetilir (lib/personnel/status.ts).
    status: v.status,
    hire_date: v.hireDate || null,
    termination_date: v.terminationDate || null,
    temp_assignment_start: v.tempAssignmentStart || null,
    report_start: v.reportStart || null,
    leave_start: v.leaveStart || null,
    absence_days_count: absenceDays,
    return_date: v.returnDate || null,
    phone: v.phone || null,
  };
  // Hassas alanlar yalnızca kullanıcı bilerek değiştirdiyse yazılır; aksi halde mevcut değere dokunulmaz.
  if (v.tcNoChanged) row.tc_no = v.tcNo === "" ? null : v.tcNo;
  if (v.ibanChanged) row.iban = v.iban === "" ? null : normalizeIban(v.iban);
  return row;
}

/** Personel oluşturur/günceller. Yetki RLS'tedir (owner/partner yazar; viewer ve admin yazamaz). */
export async function savePersonnel(
  siteId: number,
  personId: number | null,
  input: PersonnelValues,
): Promise<Result<{ id: number }>> {
  await requireUser();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };

  const parsed = personnelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };

  const supabase = await createClient();
  const row = toRow(parsed.data);

  if (personId === null) {
    const { data, error } = await supabase.from("personnel").insert({ ...row, site_id: siteId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    revalidatePath(`/sites/${siteId}/personel`);
    return { ok: true, id: data.id };
  }

  const { data, error } = await supabase
    .from("personnel")
    .update(row)
    .eq("id", personId)
    .eq("site_id", siteId)
    .select("id"); // "*" değil: hassas sütunlar döndürülemez
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };

  revalidatePath(`/sites/${siteId}/personel`);
  return { ok: true, id: personId };
}

/** Yalnızca şantiye sahibi siler (RLS). Silmek personelin puantaj geçmişini de siler; normal çıkış için durum 'Ayrıldı' yapılır. */
export async function deletePersonnel(siteId: number, personId: number): Promise<Result> {
  await requireUser();
  if (!Number.isInteger(siteId) || !Number.isInteger(personId)) return { ok: false, error: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("personnel")
    .delete()
    .eq("id", personId)
    .eq("site_id", siteId)
    .select("id");
  if (error) {
    return { ok: false, error: error.code === "23503" ? "Bu personele bağlı kayıtlar var, silinemez. Durumunu 'Ayrıldı' yapın." : GENERIC_ERROR };
  }
  if (!data || data.length === 0) return { ok: false, error: "Personeli yalnızca şantiyenin sahibi silebilir." };

  revalidatePath(`/sites/${siteId}/personel`);
  return { ok: true };
}

/**
 * "Göster" düğmesi: TC no ve IBAN'ı yalnızca admin ile owner/partner'a açar (RPC içinde doğrulanır),
 * her çağrı erişim günlüğüne yazılır. Değerler yalnızca bu cevapta döner; sayfa verisine/önbelleğe girmez.
 */
export async function revealPersonnelSensitive(
  personId: number,
): Promise<Result<{ tcNo: string | null; iban: string | null }>> {
  await requireUser();
  if (!Number.isInteger(personId)) return { ok: false, error: "Geçersiz istek." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_personnel_sensitive", { p_personnel_id: personId });
  if (error) {
    return { ok: false, error: error.code === "42501" ? "Bu bilgiyi görme yetkiniz yok." : "Bilgi getirilemedi, tekrar deneyin." };
  }
  const row = (data as { tc_no: string | null; iban: string | null }[] | null)?.[0];
  if (!row) return { ok: false, error: "Kayıt bulunamadı." };
  return { ok: true, tcNo: row.tc_no, iban: row.iban };
}
