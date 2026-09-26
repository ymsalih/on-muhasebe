import { Building2 } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold">Şantiye Ön Muhasebe</h1>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">{children}</div>
      </div>
    </main>
  );
}
