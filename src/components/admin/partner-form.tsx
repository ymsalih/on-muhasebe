"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { StickyActionBar } from "@/components/layout/sticky-action-bar";
import { createPartner } from "@/lib/admin/actions";
import { generatePassword } from "@/lib/admin/password";
import { createPartnerSchema, type CreatePartnerValues } from "@/lib/admin/schemas";

export function PartnerForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string; fullName: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreatePartnerValues>({
    resolver: zodResolver(createPartnerSchema),
    defaultValues: { fullName: "", email: "", phone: "", password: "" },
  });

  async function onSubmit(values: CreatePartnerValues) {
    setFormError(null);
    const result = await createPartner(values).catch(() => null);
    if (!result) {
      setFormError("Ortak eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
      return;
    }
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setCreated({ email: values.email.trim().toLowerCase(), password: values.password, fullName: values.fullName });
  }

  async function copyCredentials() {
    if (!created) return;
    const text = `E-posta: ${created.email}\nGeçici şifre: ${created.password}\nİlk girişte şifrenizi değiştirmeniz istenecek.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (created) {
    return (
      <div className="max-w-2xl space-y-4">
        <div className="space-y-3 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-5" aria-hidden />
            <h2 className="font-semibold">{created.fullName} eklendi</h2>
          </div>
          <dl className="space-y-2 rounded-lg bg-muted p-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">E-posta</dt>
              <dd className="break-all font-medium">{created.email}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Geçici şifre</dt>
              <dd className="font-mono font-medium">{created.password}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            Bu şifre bir daha gösterilmeyecek. Ortağa e-posta ile değil, WhatsApp veya telefonla iletin. İlk girişte
            şifresini değiştirmesi istenecek.
          </p>
          <Button type="button" variant="outline" className="h-11 w-full" onClick={copyCredentials}>
            <Copy aria-hidden />
            {copied ? "Kopyalandı" : "Bilgileri Kopyala"}
          </Button>
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            className="h-11 flex-1"
            onClick={() => {
              reset();
              setCreated(null);
            }}
          >
            Yeni Ortak Ekle
          </Button>
          <Link
            href="/admin/ortaklar"
            className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border text-sm font-medium hover:bg-muted"
          >
            Ortaklara Dön
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-5 pb-24 md:pb-0" noValidate>
      <FormError message={formError} />

      <fieldset className="space-y-4 rounded-xl border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">Kişi Bilgileri</legend>
        <Field id="fullName" label="Ad soyad" error={errors.fullName?.message}>
          <Input id="fullName" autoComplete="off" className="h-11" aria-invalid={!!errors.fullName} {...register("fullName")} />
        </Field>
        <Field id="email" label="E-posta (giriş adı)" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="off"
            className="h-11"
            aria-invalid={!!errors.email}
            {...register("email")}
          />
        </Field>
        <Field id="phone" label="Telefon (opsiyonel)" error={errors.phone?.message}>
          <Input id="phone" type="tel" inputMode="tel" autoComplete="off" className="h-11" aria-invalid={!!errors.phone} {...register("phone")} />
        </Field>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">Geçici Şifre</legend>
        <Field id="password" label="İlk giriş şifresi" error={errors.password?.message}>
          <div className="flex gap-2">
            <Input
              id="password"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-11 font-mono"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0"
              onClick={() => setValue("password", generatePassword(), { shouldValidate: true, shouldDirty: true })}
            >
              <RefreshCw aria-hidden />
              Oluştur
            </Button>
          </div>
        </Field>
        <p className="text-xs text-muted-foreground">Ortak ilk girişte bu şifreyi değiştirmek zorunda kalacak.</p>
      </fieldset>

      <StickyActionBar>
        <Button type="submit" className="h-12 flex-1 text-base" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          Ortağı Ekle
        </Button>
      </StickyActionBar>
    </form>
  );
}
