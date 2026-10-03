import Image from "next/image";
import { Building2 } from "lucide-react";
import arkaplan from "@/assets/arkaplan.jpg";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-neutral-900 px-4 py-8">
      {/* Arkaplan: orijinal 6000×4000 görsel; Next.js ekran genişliğine uygun çözünürlükte (retina dahil) sunar, oran bozulmadan kaplar. */}
      <Image src={arkaplan} alt="" fill priority sizes="100vw" quality={90} placeholder="blur" className="-z-20 object-cover object-[35%_center]" />
      {/* Okunabilirlik için hafif koyu katman */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/50 via-black/35 to-black/55" />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
            <Building2 className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold text-white drop-shadow-md">Şantiye Ön Muhasebe</h1>
        </div>
        <div className="rounded-xl border border-white/20 bg-card/95 p-5 shadow-xl backdrop-blur-sm sm:p-6">{children}</div>
      </div>
    </main>
  );
}
