import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "partner";
  must_change_password: boolean;
};

/**
 * Giriş yapmış kullanıcının kimliği (JWT `sub`). Bu proje asimetrik (ES256) JWT imzası kullanır; getClaims()
 * imzayı ve süreyi YEREL olarak (önbelleğe alınmış JWKS ile) doğrular, Supabase Auth'a ağ isteği YAPMAZ.
 * (getUser() her çağrıda ~150–1000 ms'lik ağ turu ekliyordu.) Silinmiş/pasif kullanıcı, profil satırı bulunamadığı
 * için getProfile() tarafından yine "giriş yok" sayılır; iptal edilen bir token en geç süresi dolunca (1 saat) düşer.
 * Aynı istekte tek kez hesaplanır (cache).
 */
export const getAuthUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
});

/** Giriş yapmış kullanıcının profili; yoksa null. Aynı istekte tek sorgu (cache). */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const id = await getAuthUserId();
  if (!id) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, full_name, email, role, must_change_password")
    .eq("id", id)
    .maybeSingle();

  return (data as Profile | null) ?? null;
});

/**
 * Yalnızca "giriş yapılmış mı ve kim" gereken yerler (server action'lar) için: ağ isteği YAPMAZ (JWT yerel doğrulanır).
 * Yetki zaten RLS'tedir; profil (rol, şifre değiştirme bayrağı) gerekmiyorsa bunu kullan.
 */
export async function requireAuthId(): Promise<string> {
  const id = await getAuthUserId();
  if (!id) redirect("/login");
  return id;
}

/** Giriş zorunlu; ilk girişte şifre değiştirme ekranına yönlendirir. */
export async function requireUser(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.must_change_password) redirect("/change-password");
  return profile;
}

/** Yalnızca admin. Partner ise kendi şantiye listesine döner. */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireUser();
  if (profile.role !== "admin") redirect("/sites");
  return profile;
}
