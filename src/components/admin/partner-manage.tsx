"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Check, CheckCircle2, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/auth/field";
import { archivePartner, deletePartner, resetPartnerPassword, restorePartner, updatePartner } from "@/lib/admin/partner-actions";
import { generatePassword } from "@/lib/admin/password";
import { describeCounts } from "@/lib/sites/data-labels";

/**
 * Admin → ortak hesabı yönetimi: düzenle, geçici şifre ver, arşive al / geri al, sil.
 * Kural: VERİSİ OLMAYAN ve şantiye sahibi olmayan hesap silinir; aksi halde arşive alınır (giriş kapanır, veriler korunur).
 */
export function PartnerManage({
  userId,
  fullName,
  email,
  phone,
  archived,
  summary,
}: {
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  archived: boolean;
  summary: { counts: Record<string, number>; total: number; ownedSites: number; memberSites: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(fullName);
  const [tel, setTel] = useState(phone);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const blockedByData = (summary?.total ?? 0) > 0;
  const blockedBySites = (summary?.ownedSites ?? 0) > 0;
  const canDelete = summary !== null && !blockedByData && !blockedBySites;
  const dirty = name !== fullName || tel !== phone;

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
    if (name.trim().length < 2) return setError("Ad soyad en az 2 karakter olmalı.");
    run(() => updatePartner(userId, { fullName: name, phone: tel }), "Ortak bilgileri kaydedildi.");
  }

  function onResetPassword() {
    if (!window.confirm(`${fullName} için yeni geçici şifre oluşturulsun mu? Mevcut şifresi geçersiz olur ve ilk girişte değiştirmeye zorlanır.`)) return;
    const password = generatePassword();
    run(() => resetPartnerPassword(userId, password), "Yeni geçici şifre oluşturuldu.", () => {
      setTempPassword(password);
      setCopied(false);
    });
  }

  function onArchive() {
    const text = archived
      ? `${fullName} arşivden çıkarılsın mı? Yeniden giriş yapabilir.`
      : `${fullName} arşive alınsın mı?\n\nGiriş yapamaz ve hiçbir şantiyeyi göremez; girdiği veriler korunur. İstediğiniz zaman geri alabilirsiniz.`;
    if (!window.confirm(text)) return;
    run(() => (archived ? restorePartner(userId) : archivePartner(userId)), archived ? "Ortak arşivden çıkarıldı." : "Ortak arşive alındı.");
  }

  function onDelete() {
    if (!window.confirm(`${fullName} hesabı kalıcı olarak silinsin mi?\n\nBu işlem geri alınamaz.`)) return;
    run(() => deletePartner(userId), "Ortak silindi.", () => {
      router.replace("/admin/ortaklar");
      router.refresh();
    });
  }

  async function copyPassword() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
    } catch {
      /* panoya erişilemezse şifre ekranda görünür kalır */
    }
  }

  return (
    <div className="space-y-5">
      <FormError message={error} />
      {notice && !tempPassword && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="size-4 shrink-0" aria-hidden />
          {notice}
        </p>
      )}

      {tempPassword && (
        <section className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4" aria-label="Yeni geçici şifre">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-4" aria-hidden />
            Yeni geçici şifre — yalnızca şimdi gösterilir
          </p>
          <p className="break-all rounded-lg bg-background/60 px-3 py-2.5 font-mono text-base" data-testid="temp-password">
            {tempPassword}
          </p>
          <p className="text-xs text-muted-foreground">Şifreyi WhatsApp/telefonla iletin. Ortak ilk girişte kendi şifresini belirler.</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={copyPassword}>
              <Copy aria-hidden />
              {copied ? "Kopyalandı" : "Kopyala"}
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => setTempPassword(null)}>
              Kapat
            </Button>
          </div>
        </section>
      )}

      <form onSubmit={onSave} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
        <h2 className="text-sm font-semibold">Ortak Bilgileri</h2>
        <Field id="pm-name" label="Ad soyad">
          <Input id="pm-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="pm-email" label="E-posta (giriş kimliği, değiştirilemez)">
          <Input id="pm-email" className="h-11" value={email} readOnly disabled />
        </Field>
        <Field id="pm-phone" label="Telefon (opsiyonel)">
          <Input id="pm-phone" type="tel" inputMode="tel" className="h-11" value={tel} onChange={(e) => setTel(e.target.value)} />
        </Field>
        <Button type="submit" className="h-12 w-full text-base" disabled={pending || !dirty}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          Değişiklikleri Kaydet
        </Button>
      </form>

      <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Şifre">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4" aria-hidden />
          Şifre
        </h2>
        <p className="text-sm text-muted-foreground">Ortak şifresini unuttuysa yeni bir geçici şifre verin; ilk girişte değiştirmesi istenir.</p>
        <Button type="button" variant="outline" className="h-11 w-full" onClick={onResetPassword} disabled={pending} data-testid="reset-password">
          <KeyRound aria-hidden />
          Yeni Geçici Şifre Oluştur
        </Button>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Arşiv">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
          Arşiv
        </h2>
        <p className="text-sm text-muted-foreground">
          {archived
            ? "Bu ortak arşivde: giriş yapamaz ve şantiyeleri göremez. Girdiği veriler korunur."
            : "Ortak artık çalışmıyorsa hesabını silmek yerine arşive alın: giriş kapanır, girdiği veriler korunur ve geri alınabilir."}
        </p>
        <Button type="button" variant="outline" className="h-11 w-full" onClick={onArchive} disabled={pending} data-testid="archive-toggle">
          {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {archived ? "Arşivden Çıkar" : "Arşive Al"}
        </Button>
      </section>

      <section className="space-y-3 rounded-xl border border-destructive/30 bg-card p-4" aria-label="Ortağı sil">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <Trash2 className="size-4" aria-hidden />
          Ortağı Sil
        </h2>
        {summary === null ? (
          <p className="text-sm text-muted-foreground">Veri durumu okunamadı; silme şu an kullanılamıyor.</p>
        ) : blockedByData || blockedBySites ? (
          <div className="space-y-1.5 text-sm text-muted-foreground" data-testid="delete-blocked">
            {blockedByData && (
              <p>
                Bu ortağın verisi var (<span className="font-medium text-foreground">{describeCounts(summary.counts)}</span>); silinemez.
              </p>
            )}
            {blockedBySites && <p>{summary.ownedSites} şantiyenin sahibi; önce şantiyeleri silin ya da arşive alın.</p>}
            <p>Verileri korumak için ortağı arşive alın.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Bu ortağın hiç verisi yok ve şantiye sahibi değil; silebilirsiniz ({summary.memberSites} şantiyeden üyeliği de kalkar). Silinen hesap geri getirilemez.
          </p>
        )}
        <Button type="button" variant="destructive" className="h-11 w-full" onClick={onDelete} disabled={pending || !canDelete} data-testid="delete-partner">
          <Trash2 aria-hidden />
          Ortağı Sil
        </Button>
      </section>
    </div>
  );
}
