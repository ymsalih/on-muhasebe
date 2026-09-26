"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addMemberSchema,
  createPartnerSchema,
  createSiteSchema,
  type CreatePartnerValues,
  type CreateSiteValues,
} from "@/lib/admin/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";

function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Girilen bilgiler geçersiz.";
}

/**
 * Yeni ortak (CLAUDE.md Bölüm 6, Auth akışı): auth.admin.createUser ile e-posta doğrulaması atlanarak
 * oluşturulur, users satırı must_change_password = true ile eklenir. Yetki DAİMA sunucuda yeniden doğrulanır;
 * istemciden gelen hiçbir şeye güvenilmez.
 */
export async function createPartner(input: CreatePartnerValues): Promise<Result<{ userId: string }>> {
  await requireAdmin();

  const parsed = createPartnerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { fullName, email, phone, password, siteIds } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true, // kapalı/davetli sistem
  });

  if (createError || !created.user) {
    if (createError?.code === "email_exists" || /already|registered/i.test(createError?.message ?? "")) {
      return { ok: false, error: "Bu e-posta adresi zaten kayıtlı." };
    }
    if (createError?.code === "weak_password") {
      return { ok: false, error: "Şifre çok zayıf, daha güçlü bir geçici şifre belirleyin." };
    }
    return { ok: false, error: GENERIC_ERROR };
  }

  const userId = created.user.id;

  const { error: profileError } = await admin.from("users").insert({
    id: userId,
    full_name: fullName,
    email: normalizedEmail,
    role: "partner",
    phone: phone || null,
    must_change_password: true, // ilk girişte şifre değiştirmeye zorlanır
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(userId); // yarım kayıt bırakma
    return { ok: false, error: GENERIC_ERROR };
  }

  if (siteIds.length > 0) {
    const { error: memberError } = await admin
      .from("site_members")
      .insert(siteIds.map((siteId) => ({ site_id: siteId, user_id: userId, role: "partner" })));
    if (memberError) {
      await admin.auth.admin.deleteUser(userId); // users satırı ON DELETE CASCADE ile gider
      return { ok: false, error: "Ortak oluşturulamadı: seçilen şantiyelerden biri bulunamadı." };
    }
  }

  revalidatePath("/admin", "layout");
  return { ok: true, userId };
}

/** Yeni şantiye: sites satırı + seçilen ortaklar için site_members satırları. Yazma RLS ile de yalnızca admine açıktır. */
export async function createSite(input: CreateSiteValues): Promise<Result<{ siteId: number }>> {
  const profile = await requireAdmin();

  const parsed = createSiteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { name, address, startDate, members } = parsed.data;

  const supabase = await createClient();

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .insert({ name, address: address || null, start_date: startDate || null, created_by: profile.id })
    .select("id")
    .single();

  if (siteError || !site) return { ok: false, error: GENERIC_ERROR };

  if (members.length > 0) {
    const { error: memberError } = await supabase.from("site_members").insert(
      members.map((m) => ({
        site_id: site.id,
        user_id: m.userId,
        role: m.role,
        share_percentage: m.sharePercentage,
      })),
    );
    if (memberError) {
      await supabase.from("sites").delete().eq("id", site.id); // yarım kayıt bırakma
      return { ok: false, error: "Şantiye oluşturulamadı: seçilen ortaklardan biri bulunamadı." };
    }
  }

  revalidatePath("/admin", "layout");
  revalidatePath("/sites");
  return { ok: true, siteId: site.id };
}

export async function addSiteMember(input: unknown): Promise<Result> {
  await requireAdmin();

  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { siteId, userId, role, sharePercentage } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_members")
    .insert({ site_id: siteId, user_id: userId, role, share_percentage: sharePercentage });

  if (error) {
    return { ok: false, error: error.code === "23505" ? "Bu ortak zaten şantiyenin üyesi." : GENERIC_ERROR };
  }

  revalidatePath("/admin", "layout");
  return { ok: true };
}

export async function removeSiteMember(memberId: number): Promise<Result> {
  await requireAdmin();
  if (!Number.isInteger(memberId)) return { ok: false, error: "Geçersiz istek." };

  const supabase = await createClient();
  const { error } = await supabase.from("site_members").delete().eq("id", memberId);
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/admin", "layout");
  return { ok: true };
}

export async function setSiteStatus(siteId: number, status: "active" | "closed"): Promise<Result> {
  await requireAdmin();
  if (!Number.isInteger(siteId) || (status !== "active" && status !== "closed")) {
    return { ok: false, error: "Geçersiz istek." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sites").update({ status }).eq("id", siteId);
  if (error) return { ok: false, error: GENERIC_ERROR };

  revalidatePath("/admin", "layout");
  revalidatePath("/sites");
  return { ok: true };
}
