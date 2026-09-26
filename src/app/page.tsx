import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId, requireUser } from "@/lib/auth/session";

/** Giriş sonrası yönlendirme: rol sorulmaz, otomatik belirlenir (CLAUDE.md 7.3-A). */
export default async function HomePage() {
  // Profil ve üyelikler paralel istenir (kimlik JWT'den yerel okunur).
  const supabase = await createClient();
  const userId = (await getAuthUserId()) ?? "";
  const [profile, { data: memberships }] = await Promise.all([
    requireUser(),
    supabase.from("site_members").select("site_id").eq("user_id", userId),
  ]);

  if (profile.role === "admin") redirect("/admin");

  // Partner: tek şantiyesi varsa seçim ekranı atlanır (7.3-B).

  if (memberships?.length === 1) redirect(`/sites/${memberships[0].site_id}`);
  redirect("/sites");
}
