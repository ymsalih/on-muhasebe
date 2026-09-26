"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { todayInIstanbul, workAvailability, type WorkInput } from "@/lib/personnel/status";

type Result = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "Puantaj kaydedilemedi, bağlantınızı kontrol edip tekrar deneyin.";

const inputSchema = z.object({
  siteId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçersiz tarih."),
  add: z.array(z.number().int().positive()).max(1000),
  remove: z.array(z.number().int().positive()).max(1000),
});

/**
 * Bir günün puantajını kaydeder (yalnızca DEĞİŞENLER gelir: eklenenler / çıkarılanlar).
 * Yetki ve gelecek-tarih kuralı veritabanında (RLS + set_attendance) uygulanır; burada ek olarak
 * "o tarihte çalışamayacak" kişilerin (izinli, raporlu, ayrılmış…) işaretlenmesi engellenir.
 */
export async function saveAttendance(input: z.input<typeof inputSchema>): Promise<Result> {
  await requireAuthId();

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz istek." };
  const { siteId, date, add, remove } = parsed.data;

  if (date > todayInIstanbul()) return { ok: false, error: "Gelecek bir tarihe puantaj girilemez." };

  const supabase = await createClient();

  if (add.length > 0) {
    const { data: people, error } = await supabase
      .from("personnel")
      .select("id, full_name, status, hire_date, termination_date, temp_assignment_start, report_start, leave_start, return_date, absence_days_count")
      .eq("site_id", siteId)
      .in("id", add);
    if (error) return { ok: false, error: GENERIC_ERROR };

    const rows = (people ?? []) as unknown as (WorkInput & { id: number; full_name: string })[];
    if (rows.length !== new Set(add).size) return { ok: false, error: "Seçilen personelden biri bu şantiyede bulunamadı." };

    const blocked = rows
      .map((p) => ({ p, a: workAvailability(p, date) }))
      .filter(({ a }) => !a.workable)
      .map(({ p, a }) => `${p.full_name} (${a.reason})`);
    if (blocked.length > 0) {
      return { ok: false, error: `Bu tarihte işaretlenemez: ${blocked.join(", ")}. Sayfayı yenileyip tekrar deneyin.` };
    }
  }

  const { error } = await supabase.rpc("set_attendance", {
    p_site_id: siteId,
    p_work_date: date,
    p_add: add,
    p_remove: remove,
  });

  if (error) {
    if (error.code === "42501") return { ok: false, error: "Bu şantiyede puantaj kaydetme yetkiniz yok." };
    if (error.code === "22007") return { ok: false, error: "Gelecek bir tarihe puantaj girilemez." };
    if (error.code === "23503") return { ok: false, error: "Seçilen personel bu şantiyeye ait değil." };
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath(`/sites/${siteId}/puantaj`);
  revalidatePath(`/sites/${siteId}`);
  return { ok: true };
}

const noteSchema = z.object({
  siteId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçersiz tarih."),
  personnelId: z.number().int().positive(),
  note: z.string().trim().max(200, "Not en fazla 200 karakter olabilir."),
});

/** İşaretlenmiş bir güne kısa not ekler/günceller/siler (boş not = sil). Yetki RLS'tedir (yalnızca `note` sütunu güncellenebilir). */
export async function setAttendanceNote(input: z.input<typeof noteSchema>): Promise<Result> {
  await requireAuthId();
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz istek." };
  const { siteId, date, personnelId, note } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance")
    .update({ note: note === "" ? null : note })
    .eq("site_id", siteId)
    .eq("work_date", date)
    .eq("personnel_id", personnelId)
    .select("id");

  if (error) return { ok: false, error: GENERIC_ERROR };
  if (!data || data.length === 0) return { ok: false, error: "Not eklemek için önce puantajı kaydedin ya da yetkiniz yok." };

  revalidatePath(`/sites/${siteId}/puantaj`);
  return { ok: true };
}
