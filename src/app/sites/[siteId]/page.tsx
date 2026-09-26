import { LayoutDashboard } from "lucide-react";

/** Şantiye ana sayfası iskeleti (Faz 1). Özet kartları ve son hareketler Faz 2 / Faz 7'de gelecek. */
export default function SiteHomePage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center">
      <LayoutDashboard className="size-10 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">Şantiye paneli hazır</h2>
      <p className="text-sm text-muted-foreground">
        Kasa, puantaj, cari ve irsaliye ekranları sonraki fazlarda bu panele eklenecek.
      </p>
    </div>
  );
}
