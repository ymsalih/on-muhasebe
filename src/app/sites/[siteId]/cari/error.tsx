"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Hata durumu (CLAUDE.md 7.1): teknik kod değil anlaşılır mesaj. */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center" role="alert">
      <AlertCircle className="size-10 text-destructive" aria-hidden />
      <h2 className="text-lg font-semibold">Cari hesaplar yüklenemedi</h2>
      <p className="text-sm text-muted-foreground">Bağlantınızı kontrol edip tekrar deneyin.</p>
      <Button className="h-11" onClick={reset}>
        Tekrar Dene
      </Button>
    </div>
  );
}
