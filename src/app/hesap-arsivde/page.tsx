import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Archive, LogOut } from "lucide-react";
import { getProfile } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Hesap Arşivde — ÖZN YOL" };

/** Arşive alınan (pasif) hesabın karşılandığı sayfa: veri göstermez, yalnızca bilgi verir ve çıkış sağlar. */
export default async function ArchivedAccountPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.archived_at) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 text-center">
        <Archive className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Hesabınız arşivde</h1>
        <p className="text-sm text-muted-foreground">
          Hesabınız yönetici tarafından arşive alındı. Girdiğiniz veriler korunuyor; erişim için yöneticinizle iletişime geçin.
        </p>
        <form action={signOut}>
          <button type="submit" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            <LogOut className="size-4" aria-hidden />
            Çıkış Yap
          </button>
        </form>
      </div>
    </main>
  );
}
