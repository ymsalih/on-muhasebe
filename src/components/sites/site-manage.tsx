"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { deleteSite, setSiteArchived, updateSiteDetails } from "@/lib/sites/manage-actions";
import { describeCounts } from "@/lib/sites/data-labels";
import { createSiteSchema } from "@/lib/sites/schemas";

/**
 * Şantiye düzenleme / arşiv / silme (sahip ve admin). Kural: VERİSİ OLMAYAN şantiye silinir, VERİSİ OLAN şantiye
 * silinemez, arşive alınır (arşivde tüm veriler salt okunurdur ve geri alınabilir). Karar veritabanında da uygulanır.
 */
export function SiteManage({
  siteId,
  initial,
  status,
  summary,
  afterDeleteHref,
}: {
  siteId: number;
  initial: { name: string; address: string; startDate: string };
  status: "active" | "closed" | "archived";
  /** Şantiyedeki tüm veri (her ortağın verisi dahil) ve üye sayısı */
  summary: { counts: Record<string, number>; total: number; members: number } | null;
  afterDeleteHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const archived = status === "archived";
  const hasData = (summary?.total ?? 0) > 0;
  const dirty = name !== initial.name || address !== initial.address || startDate !== initial.startDate;

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, then?: () => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn().catch(() => null);
      if (!res) return setError("İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.");
      if (!res.ok) return setError(res.error);
      setNotice(done);
      if (then) then();
      else router.refresh();
    });
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createSiteSchema.safeParse({ name, address, startDate });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Girilen bilgiler geçersiz.");
    run(() => updateSiteDetails(siteId, parsed.data), "Şantiye bilgileri kaydedildi.");
  }

  function onArchive() {
    const text = archived
      ? "Şantiye arşivden çıkarılsın mı? Tüm üyeler yeniden veri girebilir."
      : "Şantiye arşive alınsın mı?\n\nArşivdeki şantiyede hiç kimse veri ekleyemez, değiştiremez veya silemez; veriler korunur ve görüntülenebilir. İstediğiniz zaman geri alabilirsiniz.";
    if (!window.confirm(text)) return;
    run(() => setSiteArchived(siteId, !archived), archived ? "Şantiye arşivden çıkarıldı." : "Şantiye arşive alındı.");
  }

  function onDelete() {
    const members = summary?.members ?? 0;
    const text = `“${initial.name}” kalıcı olarak silinsin mi?${members > 1 ? `\n\nBu şantiyedeki ${members} üyenin erişimi de kalkar.` : ""}\n\nBu işlem geri alınamaz.`;
    if (!window.confirm(text)) return;
    run(() => deleteSite(siteId), "Şantiye silindi.", () => {
      router.replace(afterDeleteHref);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <FormError message={error} />
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="size-4 shrink-0" aria-hidden />
          {notice}
        </p>
      )}

      <form onSubmit={onSave} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
        <h2 className="text-sm font-semibold">Şantiye Bilgileri</h2>
        <Field id="sm-name" label="Şantiye adı">
          <Input id="sm-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="sm-address" label="Adres (opsiyonel)">
          <Input id="sm-address" className="h-11" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field id="sm-start" label="Başlangıç tarihi (opsiyonel)">
          <Input id="sm-start" type="date" className="h-11" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Button type="submit" className="h-12 w-full text-base" disabled={pending || !dirty}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          Değişiklikleri Kaydet
        </Button>
      </form>

      <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Arşiv">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
          Arşiv
        </h2>
        <p className="text-sm text-muted-foreground">
          {archived
            ? "Bu şantiye arşivde: veriler korunur ve görüntülenebilir, ancak hiç kimse veri ekleyemez veya değiştiremez."
            : "Biten ya da kapanan şantiyeyi silmek yerine arşive alın: veriler korunur, şantiye salt okunur olur ve listede “Arşiv” bölümüne geçer."}
        </p>
        <Button type="button" variant="outline" className="h-11 w-full" onClick={onArchive} disabled={pending} data-testid="archive-toggle">
          {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {archived ? "Arşivden Çıkar" : "Arşive Al"}
        </Button>
      </section>

      <section className="space-y-3 rounded-xl border border-destructive/30 bg-card p-4" aria-label="Şantiyeyi sil">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <Trash2 className="size-4" aria-hidden />
          Şantiyeyi Sil
        </h2>
        {summary === null ? (
          <p className="text-sm text-muted-foreground">Veri durumu okunamadı; silme şu an kullanılamıyor.</p>
        ) : hasData ? (
          <p className="text-sm text-muted-foreground" data-testid="delete-blocked">
            Bu şantiyede veri var (<span className="font-medium text-foreground">{describeCounts(summary.counts)}</span>), bu yüzden silinemez.
            Verileri korumak için şantiyeyi arşive alın.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Bu şantiyede hiç veri yok; silebilirsiniz. Silinen şantiye geri getirilemez.
          </p>
        )}
        <Button type="button" variant="destructive" className="h-11 w-full" onClick={onDelete} disabled={pending || summary === null || hasData} data-testid="delete-site">
          <Trash2 aria-hidden />
          Şantiyeyi Sil
        </Button>
      </section>
    </div>
  );
}
