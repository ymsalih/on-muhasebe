"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { createClient } from "@/lib/supabase/client";
import { changePasswordSchema, type ChangePasswordValues } from "@/lib/auth/schemas";

export function ChangePasswordForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema) });

  async function onSubmit(values: ChangePasswordValues) {
    setFormError(null);
    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setFormError(
        /different|same/i.test(error.message)
          ? "Yeni şifre eskisinden farklı olmalı."
          : "Şifre değiştirilemedi, bağlantınızı kontrol edip tekrar deneyin.",
      );
      return;
    }

    // Bayrağı kaldır (RLS: kullanıcı yalnızca kendi satırında bu sütunu güncelleyebilir).
    const { error: flagError } = await supabase
      .from("users")
      .update({ must_change_password: false })
      .eq("id", userId);
    if (flagError) {
      setFormError("Şifreniz değişti ancak hesap durumu güncellenemedi. Sayfayı yenileyip tekrar deneyin.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormError message={formError} />
      <Field id="password" label="Yeni şifre" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          className="h-11"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")}
        />
      </Field>
      <Field id="confirm" label="Yeni şifre (tekrar)" error={errors.confirm?.message}>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          className="h-11"
          aria-invalid={!!errors.confirm}
          aria-describedby={errors.confirm ? "confirm-error" : undefined}
          {...register("confirm")}
        />
      </Field>
      <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        Şifreyi Kaydet
      </Button>
    </form>
  );
}
