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

/** Giriş yapmış kullanıcının profili; yoksa null. Aynı istekte tek sorgu (cache). */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser(); // sunucuda doğrulanmış kullanıcı
  if (!auth.user) return null;

  const { data } = await supabase
    .from("users")
    .select("id, full_name, email, role, must_change_password")
    .eq("id", auth.user.id)
    .maybeSingle();

  return (data as Profile | null) ?? null;
});

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
