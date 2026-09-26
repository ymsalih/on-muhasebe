"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPartnerSchema, type CreatePartnerValues } from "@/lib/admin/schemas";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const GENERIC_ERROR = "İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.";

/**
 * Yeni ortak HESABI (CLAUDE.md Bölüm 6, Auth akışı): auth.admin.createUser ile e-posta doğrulaması atlanarak
 * oluşturulur, users satırı must_change_password = true ile eklenir. Admin'in tek yazma işi budur: şantiye
 * oluşturmaz, site_members'a satır eklemez. Yetki DAİMA sunucuda yeniden doğrulanır.
 */
export async function createPartner(input: CreatePartnerValues): Promise<Result<{ userId: string }>> {
  await requireAdmin();

  const parsed = createPartnerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz." };
  const { fullName, email, phone, password } = parsed.data;
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

  revalidatePath("/admin", "layout");
  return { ok: true, userId };
}
