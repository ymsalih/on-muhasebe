"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthId } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/format";
import {
  machineDaySchema,
  machineRentalSchema,
  machineSchema,
  machineWorkable,
  num,
  rentalTotal,
  type MachineDayValues,
  type MachineRentalValues,
  type MachineStatus,
  type MachineValues,
  type RateUnit,
} from "@/lib/machines/schemas";
import { monthLabel } from "@/lib/personnel/payment-schemas";
import { todayInIstanbul } from "@/lib/personnel/status";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
const NO_WRITE_ERROR = "Bu şantiyede kayıt ekleme/düzenleme yetkiniz yok.";

function mapError(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case "42501":
      return NO_WRITE_ERROR;
    case "23505":
      return "Bu ad ve plakada bir makineniz zaten var.";
    case "23503":
      if (/Makine bulunamadı|ortağa ait/.test(error.message ?? "")) return "Seçilen makine bulunamadı.";
      if (/Kaynak gelir/.test(error.message ?? "")) return "Seçilen gelir bu şantiyeye ait bir gelir kaydı değil.";
      return "Bu makineye bağlı kira ödemeleri var; silmek için önce ödemeleri silin.";
    case "22007":
      return "Gelecek bir tarihe puantaj girilemez.";
    case "23514":
      return "Girilen bilgilerden biri geçersiz.";
    default:
      return GENERIC_ERROR;
  }
}

const refresh = (siteId: number) => {
  revalidatePath(`/sites/${siteId}/makine`);
  revalidatePath(`/sites/${siteId}`, "layout");
};

function toMachineRow(v: MachineValues) {
  return {
    name: v.name,
    machine_type: v.machineType,
    identifier: v.identifier || null,
    ownership: v.ownership,
    supplier: v.ownership === "rented" ? v.supplier || null : null,
    rate_unit: v.ownership === "rented" && v.rateUnit !== "" ? v.rateUnit : null,
    rental_rate: v.ownership === "rented" && v.rentalRate !== "" ? num(v.rentalRate) : null,
    status: v.status,
    start_date: v.startDate || null,
    end_date: v.endDate || null,
  };
}

/** Makine kartı ekler/günceller. `owner_id` oturumdan gelir; yetki RLS'tedir (yalnızca kendi makinesini yazar). */
export async function saveMachine(siteId: number, machineId: number | null, input: MachineValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId)) return { ok: false, error: "Geçersiz şantiye." };
  const parsed = machineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const row = toMachineRow(parsed.data);

  const supabase = await createClient();
  if (machineId === null) {
    const { data, error } = await supabase.from("machines").insert({ ...row, site_id: siteId, owner_id: userId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("machines").update(row).eq("id", machineId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id: machineId };
}

/** Makineyi siler; puantaj kayıtları da silinir. Kira ödemesi varsa silinemez. */
export async function deleteMachine(siteId: number, machineId: number): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(machineId)) return { ok: false, error: "Geçersiz istek." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("machines").delete().eq("id", machineId).eq("site_id", siteId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true };
}

const markSchema = z.object({
  siteId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  add: z.array(z.number().int().positive()).max(500),
  remove: z.array(z.number().int().positive()).max(500),
});

/**
 * Bir günün puantajını kaydeder (yalnızca DEĞİŞENLER). Yetki, sahiplik ve gelecek-tarih kuralı veritabanında uygulanır;
 * burada ek olarak başlangıç/ayrılış tarihine göre o gün çalışamayacak makinelerin işaretlenmesi engellenir.
 */
export async function setMachineAttendance(input: z.input<typeof markSchema>): Promise<Result> {
  await requireAuthId();
  const parsed = markSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Geçersiz istek." };
  const { siteId, date, add, remove } = parsed.data;
  if (date > todayInIstanbul()) return { ok: false, error: "Gelecek bir tarihe puantaj girilemez." };

  const supabase = await createClient();
  if (add.length > 0) {
    const { data, error } = await supabase.from("machines").select("id, name, status, start_date, end_date").eq("site_id", siteId).in("id", add);
    if (error) return { ok: false, error: GENERIC_ERROR };
    const rows = (data ?? []) as { id: number; name: string; status: MachineStatus; start_date: string | null; end_date: string | null }[];
    if (rows.length !== new Set(add).size) return { ok: false, error: "Seçilen makinelerden biri bulunamadı." };
    const blocked = rows.map((m) => ({ m, a: machineWorkable(m, date) })).filter(({ a }) => !a.workable).map(({ m, a }) => `${m.name} (${a.reason})`);
    if (blocked.length > 0) return { ok: false, error: `Bu tarihte işaretlenemez: ${blocked.join(", ")}.` };
  }

  const { error } = await supabase.rpc("set_machine_attendance", { p_site_id: siteId, p_work_date: date, p_add: add, p_remove: remove });
  if (error) return { ok: false, error: mapError(error) };
  refresh(siteId);
  return { ok: true };
}

/** İşaretli bir günün çalışma saatini ve notunu günceller (boş = temizle). */
export async function saveMachineDay(siteId: number, machineId: number, date: string, input: MachineDayValues): Promise<Result> {
  await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(machineId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Geçersiz istek." };
  const parsed = machineDaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("machine_attendance")
    .update({ hours: parsed.data.hours === "" ? null : num(parsed.data.hours), note: parsed.data.note || null })
    .eq("site_id", siteId)
    .eq("machine_id", machineId)
    .eq("work_date", date)
    .select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Önce makineyi o gün için işaretleyin." };
  refresh(siteId);
  return { ok: true };
}

const RENTAL_UNIT_LABEL: Record<RateUnit, string> = { day: "gün", hour: "saat" };

/**
 * Makine kira ödemesi kaydeder/günceller: kasada bir GİDER ("Kira (araç / ekipman)", makineye bağlı) ve isteğe bağlı
 * olarak hangi gelirden ödendiği. Tutar = miktar × birim kira, sunucuda hesaplanır. Makine kiralık ve kendi makinesi olmalı.
 */
export async function saveMachineRental(siteId: number, machineId: number, txId: number | null, input: MachineRentalValues): Promise<Result<{ id: number }>> {
  const userId = await requireAuthId();
  if (!Number.isInteger(siteId) || !Number.isInteger(machineId)) return { ok: false, error: "Geçersiz istek." };
  const parsed = machineRentalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const v = parsed.data;
  const qty = num(v.qty);
  const rate = num(v.rate);

  const supabase = await createClient();
  const [{ data: machine }, { data: cats }] = await Promise.all([
    supabase.from("machines").select("id, name, ownership, rate_unit").eq("site_id", siteId).eq("id", machineId).maybeSingle(),
    supabase.from("categories").select("id, site_id").eq("type", "expense").eq("name", "Kira (araç / ekipman)").or(`site_id.is.null,site_id.eq.${siteId}`),
  ]);
  if (!machine) return { ok: false, error: "Makine bulunamadı." };
  if (machine.ownership !== "rented" || !machine.rate_unit) return { ok: false, error: "Kira ödemesi yalnızca kira birimi tanımlı kiralık makinede yapılır." };
  const unit = machine.rate_unit as RateUnit;
  const category = (cats ?? []).find((c) => c.site_id === siteId) ?? (cats ?? [])[0];

  const row = {
    type: "expense" as const,
    amount: rentalTotal(qty, rate),
    transaction_date: v.date,
    description: `${monthLabel(v.month)} kirası — ${machine.name} (${v.qty.replace(".", ",")} ${RENTAL_UNIT_LABEL[unit]} × ${formatCurrency(rate)})`,
    payment_method: v.paymentMethod || null,
    category_id: category?.id ?? null,
    machine_id: machineId,
    machine_qty: qty,
    machine_rate: rate,
    machine_unit: unit,
    period_month: `${v.month}-01`,
    source_income_id: v.sourceIncomeId ? Number(v.sourceIncomeId) : null,
  };

  if (txId === null) {
    const { data, error } = await supabase.from("transactions").insert({ ...row, site_id: siteId, user_id: userId }).select("id").single();
    if (error || !data) return { ok: false, error: error ? mapError(error) : GENERIC_ERROR };
    refresh(siteId);
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("transactions").update(row).eq("id", txId).eq("site_id", siteId).eq("machine_id", machineId).eq("user_id", userId).select("id");
  if (error) return { ok: false, error: mapError(error) };
  if (!data || data.length === 0) return { ok: false, error: NO_WRITE_ERROR };
  refresh(siteId);
  return { ok: true, id: txId };
}

