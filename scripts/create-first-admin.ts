/**
 * İlk admin kullanıcısını oluşturur (bootstrap). Tekrar çalıştırılabilir (idempotent).
 *
 *   npx tsx scripts/create-first-admin.ts
 *
 * Gerekli ortam değişkenleri (.env.local veya .env — şifre ASLA kod içine yazılmaz):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ADMIN_EMAIL
 *   ADMIN_PASSWORD
 *   ADMIN_FULL_NAME   (opsiyonel, varsayılan: "Admin")
 *
 * Akış (CLAUDE.md Bölüm 6):
 *   1) supabase.auth.admin.createUser({ email, password, email_confirm: true })
 *   2) dönen auth.users.id ile public.users tablosuna role = 'admin' satırı ekler.
 *
 * Kullanıcı zaten varsa (auth'ta ya da users tablosunda) yeniden oluşturulmaz;
 * eksik olan kısım tamamlanır ve rolü 'admin' olarak garanti edilir. Mevcut şifre değiştirilmez.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config({ path: ".env" });

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Hata: ${name} ortam değişkeni tanımlı değil (.env.local dosyasına ekleyin).`);
    process.exit(1);
  }
  return value;
}

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const email = requireEnv("ADMIN_EMAIL").toLowerCase();
const password = requireEnv("ADMIN_PASSWORD");
const fullName = process.env.ADMIN_FULL_NAME?.trim() || "Admin";

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Hata: ADMIN_EMAIL geçerli bir e-posta adresi değil.");
  process.exit(1);
}
if (password.length < 10) {
  console.error("Hata: ADMIN_PASSWORD en az 10 karakter olmalı.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserIdByEmail(target: string): Promise<string | null> {
  const perPage = 200;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
}

async function main() {
  let userId: string;
  let createdNow = false;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // kapalı/davetli sistem: e-posta doğrulaması atlanır
  });

  if (created?.user) {
    userId = created.user.id;
    createdNow = true;
    console.log(`Auth kullanıcısı oluşturuldu: ${email}`);
  } else if (createError && /already|registered|exists/i.test(createError.message)) {
    const existingId = await findAuthUserIdByEmail(email);
    if (!existingId) throw createError;
    userId = existingId;
    console.log(`Auth kullanıcısı zaten var, yeniden oluşturulmadı: ${email}`);
  } else {
    throw createError ?? new Error("Auth kullanıcısı oluşturulamadı.");
  }

  // Admin kendi seçtiği şifreyle girer; geçici şifre olmadığı için zorunlu değişiklik istenmez.
  const { error: upsertError } = await supabase.from("users").upsert(
    { id: userId, full_name: fullName, email, role: "admin", must_change_password: false },
    { onConflict: "id" },
  );

  if (upsertError) {
    if (createdNow) {
      // Yarım kalmış kayıt bırakma: users satırı yazılamadıysa yeni açılan auth kullanıcısını geri al.
      await supabase.auth.admin.deleteUser(userId);
      console.error("users satırı yazılamadığı için auth kullanıcısı geri alındı.");
    }
    throw upsertError;
  }

  console.log(`Tamam: ${email} admin olarak hazır (id: ${userId}).`);
}

main().catch((err) => {
  console.error("Bootstrap başarısız:", err?.message ?? err);
  process.exit(1);
});
