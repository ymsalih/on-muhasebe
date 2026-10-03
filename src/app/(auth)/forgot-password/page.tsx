import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Şifremi Unuttum — ÖZN YOL" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Şifremi Unuttum</h2>
        <p className="text-sm text-muted-foreground">E-posta adresinizi girin, size bir sıfırlama bağlantısı gönderelim.</p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
