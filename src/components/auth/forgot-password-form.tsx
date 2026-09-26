"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { createClient } from "@/lib/supabase/client";
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/lib/auth/schemas";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values: ForgotPasswordValues) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(values.email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/change-password`,
    });
    if (error) {
      setFormError("İstek gönderilemedi, bağlantınızı kontrol edip tekrar deneyin.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Bu e-posta ile kayıtlı bir hesap varsa şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin.
        </p>
        <Link href="/login" className="inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline">
          Girişe dön
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormError message={formError} />
      <Field id="email" label="E-posta" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          className="h-11"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "email-error" : undefined}
          {...register("email")}
        />
      </Field>
      <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        Sıfırlama Bağlantısı Gönder
      </Button>
      <p className="text-center text-sm">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center px-2 text-muted-foreground underline-offset-4 hover:underline"
        >
          Girişe dön
        </Link>
      </p>
    </form>
  );
}
