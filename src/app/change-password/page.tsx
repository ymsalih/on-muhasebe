import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { getProfile } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Şifre Değiştir — Şantiye Ön Muhasebe" };

/** must_change_password = true ise giriş sonrası kullanıcı buraya yönlendirilir; şifre sıfırlama da buraya döner. */
export default async function ChangePasswordPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold">Şantiye Ön Muhasebe</h1>
        </div>
        <div className="space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Yeni Şifre Belirleyin</h2>
            <p className="text-sm text-muted-foreground">
              {profile.must_change_password
                ? "Devam etmeden önce size verilen geçici şifreyi değiştirmeniz gerekiyor."
                : "Hesabınız için yeni bir şifre belirleyin."}
            </p>
          </div>
          <ChangePasswordForm userId={profile.id} />
        </div>
      </div>
    </main>
  );
}
