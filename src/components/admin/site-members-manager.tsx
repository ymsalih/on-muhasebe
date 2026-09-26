"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/auth/field";
import { addSiteMember, removeSiteMember, setSiteStatus } from "@/lib/admin/actions";
import { SITE_MEMBER_ROLES, SITE_MEMBER_ROLE_LABELS } from "@/lib/admin/schemas";

export type MemberRow = {
  id: number;
  fullName: string;
  email: string;
  role: (typeof SITE_MEMBER_ROLES)[number];
  sharePercentage: number | null;
};
export type AvailablePartner = { id: string; fullName: string };

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export function SiteMembersManager({
  siteId,
  status,
  members,
  available,
}: {
  siteId: number;
  status: "active" | "closed";
  members: MemberRow[];
  available: AvailablePartner[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<(typeof SITE_MEMBER_ROLES)[number]>("partner");
  const [share, setShare] = useState("");

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action().catch(() => null);
      if (!result) return setError("İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.");
      if (!result.ok) return setError(result.error ?? "İşlem tamamlanamadı.");
      onOk?.();
    });
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return setError("Eklenecek ortağı seçin.");
    const parsedShare = share.trim() === "" ? null : Number(share.trim().replace(",", "."));
    run(
      () => addSiteMember({ siteId, userId, role, sharePercentage: parsedShare }),
      () => {
        setUserId("");
        setShare("");
        setRole("partner");
      },
    );
  }

  return (
    <div className="space-y-5">
      <FormError message={error} />

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Üyeler</h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu şantiyeye henüz ortak atanmadı.</p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.id} className="flex min-h-14 items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {SITE_MEMBER_ROLE_LABELS[m.role]}
                    {m.sharePercentage !== null && ` · %${m.sharePercentage}`} · {m.email}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="size-11 shrink-0 text-destructive"
                  disabled={pending}
                  aria-label={`${m.fullName} kişisini şantiyeden çıkar`}
                  onClick={() => {
                    if (window.confirm(`${m.fullName} bu şantiyeden çıkarılsın mı? Şantiye verilerine erişimi kalkar.`)) {
                      run(() => removeSiteMember(m.id));
                    }
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={onAdd} className="space-y-3 rounded-xl border bg-card p-4" noValidate>
        <h2 className="text-sm font-semibold">Ortak Ekle</h2>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">Eklenebilecek başka ortak yok.</p>
        ) : (
          <>
            <div className="space-y-1">
              <label htmlFor="member-user" className="text-xs text-muted-foreground">
                Ortak
              </label>
              <select id="member-user" className={selectClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Seçin…</option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label htmlFor="member-role" className="text-xs text-muted-foreground">
                  Rol
                </label>
                <select
                  id="member-role"
                  className={selectClass}
                  value={role}
                  onChange={(e) => setRole(e.target.value as typeof role)}
                >
                  {SITE_MEMBER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {SITE_MEMBER_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="member-share" className="text-xs text-muted-foreground">
                  Kâr payı % (opsiyonel)
                </label>
                <Input
                  id="member-share"
                  inputMode="decimal"
                  className="h-11"
                  value={share}
                  onChange={(e) => setShare(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" className="h-11 w-full" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
              Şantiyeye Ekle
            </Button>
          </>
        )}
      </form>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Şantiye Durumu</h2>
        <p className="text-sm text-muted-foreground">
          {status === "active"
            ? "Şantiye aktif. Kapatırsanız veriler silinmez, yalnızca kapalı olarak işaretlenir."
            : "Şantiye kapalı. Yeniden açabilirsiniz."}
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={pending}
          onClick={() => {
            if (status === "active" && !window.confirm("Şantiye kapalı olarak işaretlensin mi?")) return;
            run(() => setSiteStatus(siteId, status === "active" ? "closed" : "active"));
          }}
        >
          {status === "active" ? "Şantiyeyi Kapat" : "Şantiyeyi Yeniden Aç"}
        </Button>
      </section>
    </div>
  );
}
