"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/auth/field";
import { addSiteMember, removeSiteMember, searchUsersForSite, type UserSearchResult } from "@/lib/sites/actions";
import { ADDABLE_ROLES, SITE_MEMBER_ROLE_LABELS, type SiteMemberRole } from "@/lib/sites/schemas";

export type MemberRow = {
  id: number;
  userId: string;
  fullName: string;
  email: string;
  role: SiteMemberRole;
};

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export function SitePartners({
  siteId,
  isOwner,
  currentUserId,
  members,
}: {
  siteId: number;
  isOwner: boolean;
  currentUserId: string;
  members: MemberRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UserSearchResult | null>(null);
  const [role, setRole] = useState<(typeof ADDABLE_ROLES)[number]>("partner");

  // Yazmayı bıraktıktan 300 ms sonra ara; eski isteklerin sonucu yenisini ezmesin.
  useEffect(() => {
    if (!isOwner || selected) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const res = await searchUsersForSite(siteId, trimmed).catch(() => null);
      if (cancelled) return;
      setSearching(false);
      if (!res) return setError("Arama yapılamadı, bağlantınızı kontrol edin.");
      if (!res.ok) return setError(res.error);
      setError(null);
      setResults(res.users);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected, siteId, isOwner]);

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return setError("Eklenecek ortağı arayıp seçin.");
    setError(null);
    startTransition(async () => {
      const res = await addSiteMember({ siteId, userId: selected.id, role }).catch(() => null);
      if (!res) return setError("Ortak eklenemedi, bağlantınızı kontrol edip tekrar deneyin.");
      if (!res.ok) return setError(res.error);
      setSelected(null);
      setQuery("");
      setResults(null);
      setRole("partner");
      router.refresh();
    });
  }

  function onRemove(member: MemberRow) {
    if (!window.confirm(`${member.fullName} bu şantiyeden çıkarılsın mı? Şantiye verilerine erişimi kalkar.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await removeSiteMember(siteId, member.id).catch(() => null);
      if (!res) return setError("İşlem tamamlanamadı, bağlantınızı kontrol edip tekrar deneyin.");
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <FormError message={error} />

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Üyeler</h2>
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex min-h-14 items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.fullName}
                  {m.userId === currentUserId && <span className="text-muted-foreground"> (siz)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {SITE_MEMBER_ROLE_LABELS[m.role]}
                   · {m.email}
                </p>
              </div>
              {isOwner && m.role !== "owner" && (
                <Button
                  type="button"
                  variant="ghost"
                  className="size-11 shrink-0 text-destructive"
                  disabled={pending}
                  aria-label={`${m.fullName} kişisini şantiyeden çıkar`}
                  onClick={() => onRemove(m)}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!isOwner && (
          <p className="text-xs text-muted-foreground">
            Yalnızca şantiyenin sahibi ortak ekleyebilir ve üyelerin tam listesini görebilir.
          </p>
        )}
      </section>

      {isOwner && (
        <form onSubmit={onAdd} className="space-y-3 rounded-xl border bg-card p-4" noValidate>
          <h2 className="text-sm font-semibold">Ortak Ekle</h2>
          <p className="text-sm text-muted-foreground">
            Sistemde hesabı olan bir ortağı ad veya e-postasıyla arayıp bu şantiyeye ekleyin. Hesabı olmayan biri için
            önce yöneticinizden hesap açmasını isteyin.
          </p>

          {selected ? (
            <div className="flex min-h-11 items-center gap-2 rounded-lg bg-muted px-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{selected.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">{selected.email}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="size-9 shrink-0"
                aria-label="Seçimi kaldır"
                onClick={() => setSelected(null)}
              >
                <X aria-hidden />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  type="search"
                  autoComplete="off"
                  placeholder="Ad veya e-posta ile ara"
                  aria-label="Ortak ara"
                  className="h-11 pl-9"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {searching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
              </div>
              {results !== null && (
                <ul className="divide-y rounded-lg border">
                  {results.length === 0 ? (
                    <li className="px-3 py-3 text-sm text-muted-foreground">
                      Sonuç bulunamadı. Kişi zaten üye olabilir veya hesabı henüz açılmamış olabilir.
                    </li>
                  ) : (
                    results.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          className="flex min-h-12 w-full flex-col justify-center px-3 py-1.5 text-left hover:bg-muted/50"
                          onClick={() => setSelected(u)}
                        >
                          <span className="truncate text-sm font-medium">{u.fullName}</span>
                          <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-1">
              <label htmlFor="member-role" className="text-xs text-muted-foreground">
                Rol
              </label>
              <select id="member-role" className={selectClass} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                {ADDABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {SITE_MEMBER_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
          </div>

          <Button type="submit" className="h-12 w-full text-base" disabled={pending || !selected}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
            Şantiyeye Ekle
          </Button>
        </form>
      )}
    </div>
  );
}
