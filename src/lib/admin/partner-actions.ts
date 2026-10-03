"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPartnerSchema } from "@/lib/admin/schemas";
import { describeCounts } from "@/lib/sites/data-labels";
import { getUserDataSummary } from "@/lib/sites/manage";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";
/** Hesabı "kalıcı" ban sayılacak kadar uzun süre kapatır (Supabase Auth ban_duration). */
const BAN_FOREVER = "876000h";

const updateSchema = createPartnerSchema.pick({ fullName: true, phone: true });
const passwordSchema = z.string().min(8, "Geçici şifre en az 8 karakter olmalı.").max(72, "Şifre en fazla 72 karakter olabilir.");

const refresh = () => revalidatePath("/admin", "layout");

/** Hedef kullanıcı mevcut bir ORTAK hesabı mı? (admin hesapları bu ekrandan yönetilemez) */
async function loadPartner(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("users").select("id, role, archived_at").eq("id", userId).maybeSingle();
  if (!data || data.role !== "partner") return null;
  return { admin, archivedAt: data.archived_at as string | null };
}

/** Ortağın adını ve telefonunu düzenler. (E-posta giriş kimliğidir; değiştirilmez.) */
export async function updatePartner(userId: string, input: { fullName: string; phone: string }): Promise<Result> {
  await requireAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const target = await loadPartner(userId);
  if (!target) return { ok: false, error: "Ortak bulunamadı." };
  const { error } = await target.admin.from("users").update({ full_name: parsed.data.fullName, phone: parsed.data.phone || null }).eq("id", userId);
  if (error) return { ok: false, error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

/** Ortağa yeni geçici şifre verir; ilk girişte değiştirmeye zorlanır. Şifre yalnızca çağırana bir kez gösterilir. */
export async function resetPartnerPassword(userId: string, password: string): Promise<Result> {
  await requireAdmin();
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Şifre geçersiz." };
  const target = await loadPartner(userId);
  if (!target) return { ok: false, error: "Ortak bulunamadı." };
  const { error } = await target.admin.auth.admin.updateUserById(userId, { password: parsed.data });
  if (error) return { ok: false, error: error.code === "weak_password" ? "Şifre çok zayıf, daha güçlü bir geçici şifre belirleyin." : GENERIC_ERROR };
  await target.admin.from("users").update({ must_change_password: true }).eq("id", userId);
  refresh();
  return { ok: true };
}

/**
 * Ortağı arşive alır: giriş kapanır (Auth ban) ve veritabanı hiçbir şantiye göstermez; girdiği veriler KORUNUR.
 * Verisi olmayan ortak için silme tercih edilir ama arşiv her ortak için mümkündür.
 */
export async function archivePartner(userId: string): Promise<Result> {
  await requireAdmin();
  const target = await loadPartner(userId);
  if (!target) return { ok: false, error: "Ortak bulunamadı." };
  const { error: banError } = await target.admin.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
  if (banError) return { ok: false, error: GENERIC_ERROR };
  const { error } = await target.admin.from("users").update({ archived_at: new Date().toISOString() }).eq("id", userId);
  if (error) return { ok: false, error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

/** Arşivdeki ortağı geri alır: giriş yeniden açılır. */
export async function restorePartner(userId: string): Promise<Result> {
  await requireAdmin();
  const target = await loadPartner(userId);
  if (!target) return { ok: false, error: "Ortak bulunamadı." };
  const { error: banError } = await target.admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (banError) return { ok: false, error: GENERIC_ERROR };
  const { error } = await target.admin.from("users").update({ archived_at: null }).eq("id", userId);
  if (error) return { ok: false, error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}

/**
 * Ortak hesabını kalıcı siler. YALNIZCA hiçbir verisi yoksa ve hiçbir şantiyenin sahibi değilse. Aksi halde reddedilir
 * (silme, kullanıcının özel verilerini CASCADE ile yok edeceği için kontrol burada ve sunucuda yapılır).
 */
export async function deletePartner(userId: string): Promise<Result> {
  await requireAdmin();
  const target = await loadPartner(userId);
  if (!target) return { ok: false, error: "Ortak bulunamadı." };

  const summary = await getUserDataSummary(userId); // admin oturumuyla (RPC admin kontrolü yapar)
  if (!summary) return { ok: false, error: "Veri durumu okunamadı; güvenlik için silinmedi." };
  if (summary.total > 0) {
    return { ok: false, error: `Bu ortağın verisi var (${describeCounts(summary.counts)}); silinemez. Arşive alabilirsiniz.` };
  }
  if (summary.ownedSites > 0) {
    return { ok: false, error: `Bu ortak ${summary.ownedSites} şantiyenin sahibi; silinemez. Önce şantiyeleri silin/devredin ya da ortağı arşive alın.` };
  }

  const { error } = await target.admin.auth.admin.deleteUser(userId); // users satırı ve üyelikler CASCADE ile kalkar
  if (error) return { ok: false, error: GENERIC_ERROR };
  refresh();
  return { ok: true };
}
