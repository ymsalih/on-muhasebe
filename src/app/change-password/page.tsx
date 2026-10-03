import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand/brand-logo";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { getProfile } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Şifre Değiştir — ÖZN YOL" };

/** must_change_password = true ise giriş sonrası kullanıcı buraya yönlendirilir; şifre sıfırlama da buraya döner. */
export default async function ChangePasswordPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandMark className="w-32 rounded-2xl p-3 shadow-sm ring-1 ring-border" imgClassName="w-full" priority sizes="128px" />
          <h1 className="text-balance text-xl font-semibold uppercase tracking-wide">ÖZN YOL YAPIM İNŞAAT &amp; İŞ MAKİNELERİ</h1>
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
