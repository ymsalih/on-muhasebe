"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { createClient } from "@/lib/supabase/client";
import { loginSchema, type LoginValues } from "@/lib/auth/schemas";

export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email.trim().toLowerCase(),
      password: values.password,
    });

    if (error) {
      setFormError(
        error.status && error.status >= 500
          ? "Giriş yapılamadı, bağlantınızı kontrol edip tekrar deneyin."
          : "E-posta veya şifre hatalı.",
      );
      return;
    }
    // "/" rolü okuyup admin / partner için doğru yere yönlendirir.
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormError message={formError} />
      <Field id="email" label="E-posta" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          className="h-11"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "email-error" : undefined}
          {...register("email")}
        />
      </Field>
      <Field id="password" label="Şifre" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          className="h-11"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")}
        />
      </Field>
      <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        Giriş Yap
      </Button>
      <p className="text-center text-sm">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center px-2 text-muted-foreground underline-offset-4 hover:underline"
        >
          Şifremi unuttum
        </Link>
      </p>
    </form>
  );
}
