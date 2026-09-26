import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Giriş — Şantiye Ön Muhasebe" };

export default function LoginPage() {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">Giriş Yap</h2>
      <LoginForm />
    </div>
  );
}
