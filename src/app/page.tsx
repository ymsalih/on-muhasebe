import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

/** Giriş sonrası yönlendirme: rol sorulmaz, otomatik belirlenir (CLAUDE.md 7.3-A). */
export default async function HomePage() {
  const profile = await requireUser();

  if (profile.role === "admin") redirect("/admin");

  // Partner: tek şantiyesi varsa seçim ekranı atlanır (7.3-B).
  const supabase = await createClient();
  const { data: memberships } = await supabase.from("site_members").select("site_id").eq("user_id", profile.id);

  if (memberships?.length === 1) redirect(`/sites/${memberships[0].site_id}`);
  redirect("/sites");
}
