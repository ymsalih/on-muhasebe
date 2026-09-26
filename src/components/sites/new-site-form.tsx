"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { StickyActionBar } from "@/components/layout/sticky-action-bar";
import { createSite } from "@/lib/sites/actions";
import { createSiteSchema, type CreateSiteValues } from "@/lib/sites/schemas";

export function NewSiteForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateSiteValues>({
    resolver: zodResolver(createSiteSchema),
    defaultValues: { name: "", address: "", startDate: "" },
  });

  async function onSubmit(values: CreateSiteValues) {
    setFormError(null);
    const result = await createSite(values).catch(() => null);
    if (!result) {
      setFormError("Şantiye eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
      return;
    }
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    // Oluşturan kişi otomatik owner: doğrudan yeni şantiyenin paneline geç.
    router.replace(`/sites/${result.siteId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-5 pb-24 md:pb-0" noValidate>
      <FormError message={formError} />

      <fieldset className="space-y-4 rounded-xl border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">Şantiye Bilgileri</legend>
        <Field id="name" label="Şantiye adı" error={errors.name?.message}>
          <Input id="name" autoComplete="off" className="h-11" aria-invalid={!!errors.name} {...register("name")} />
        </Field>
        <Field id="address" label="Adres (opsiyonel)" error={errors.address?.message}>
          <Input id="address" autoComplete="off" className="h-11" aria-invalid={!!errors.address} {...register("address")} />
        </Field>
        <Field id="startDate" label="Başlangıç tarihi (opsiyonel)" error={errors.startDate?.message}>
          <Input id="startDate" type="date" className="h-11" aria-invalid={!!errors.startDate} {...register("startDate")} />
        </Field>
      </fieldset>

      <p className="text-sm text-muted-foreground">
        Şantiyeyi ekleyen kişi otomatik olarak şantiyenin sahibi olur. Diğer ortakları şantiye panelindeki “Şantiye
        Ortakları” bölümünden ekleyebilirsiniz.
      </p>

      <StickyActionBar>
        <Button type="submit" className="h-12 flex-1 text-base" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          Şantiyeyi Ekle
        </Button>
      </StickyActionBar>
    </form>
  );
}
