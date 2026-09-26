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
import { createSite } from "@/lib/admin/actions";
import {
  createSiteSchema,
  SITE_MEMBER_ROLES,
  SITE_MEMBER_ROLE_LABELS,
  type CreateSiteValues,
} from "@/lib/admin/schemas";

export type PartnerOption = { id: string; fullName: string; email: string };

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/** "12,5" ve "12.5" kabul edilir; boş = null. Geçersiz değer NaN döner ve zod'da hata verir. */
function parseShare(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return Number(trimmed.replace(",", "."));
}

export function SiteForm({ partners }: { partners: PartnerOption[] }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateSiteValues>({
    resolver: zodResolver(createSiteSchema),
    defaultValues: { name: "", address: "", startDate: "", members: [] },
  });

  const members = watch("members");
  const membersError = errors.members?.message ?? errors.members?.root?.message;

  function toggleMember(userId: string) {
    const exists = members.some((m) => m.userId === userId);
    setValue(
      "members",
      exists
        ? members.filter((m) => m.userId !== userId)
        : [...members, { userId, role: members.length === 0 ? "owner" : "partner", sharePercentage: null }],
      { shouldDirty: true },
    );
  }

  function updateMember(userId: string, patch: Partial<CreateSiteValues["members"][number]>) {
    setValue(
      "members",
      members.map((m) => (m.userId === userId ? { ...m, ...patch } : m)),
      { shouldDirty: true, shouldValidate: true },
    );
  }

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
    router.replace(`/admin/santiyeler/${result.siteId}`);
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

      <fieldset className="space-y-2 rounded-xl border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">Ortaklar</legend>
        {partners.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Henüz ortak yok. Şantiyeyi şimdi oluşturup ortakları sonradan da ekleyebilirsiniz.
          </p>
        ) : (
          partners.map((partner) => {
            const member = members.find((m) => m.userId === partner.id);
            return (
              <div key={partner.id} className="rounded-lg border p-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-1">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={!!member}
                    onChange={() => toggleMember(partner.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{partner.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{partner.email}</span>
                  </span>
                </label>
                {member && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label htmlFor={`role-${partner.id}`} className="text-xs text-muted-foreground">
                        Rol
                      </label>
                      <select
                        id={`role-${partner.id}`}
                        className={selectClass}
                        value={member.role}
                        onChange={(e) => updateMember(partner.id, { role: e.target.value as typeof member.role })}
                      >
                        {SITE_MEMBER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {SITE_MEMBER_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`share-${partner.id}`} className="text-xs text-muted-foreground">
                        Kâr payı % (opsiyonel)
                      </label>
                      <Input
                        id={`share-${partner.id}`}
                        inputMode="decimal"
                        className="h-11"
                        defaultValue=""
                        onChange={(e) => updateMember(partner.id, { sharePercentage: parseShare(e.target.value) })}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
        {membersError && (
          <p role="alert" className="text-sm text-destructive">
            {membersError}
          </p>
        )}
      </fieldset>

      <StickyActionBar>
        <Button type="submit" className="h-12 flex-1 text-base" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          Şantiyeyi Ekle
        </Button>
      </StickyActionBar>
    </form>
  );
}
