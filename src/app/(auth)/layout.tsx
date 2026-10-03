import Image from "next/image";
import arkaplan from "@/assets/arkaplan.jpg";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-neutral-900 px-4 py-8">
      {/* Arkaplan: orijinal 6000×4000 görsel; Next.js ekran genişliğine uygun çözünürlükte (retina dahil) sunar, oran bozulmadan kaplar. */}
      <Image src={arkaplan} alt="" fill priority sizes="100vw" quality={90} placeholder="blur" className="-z-20 object-cover object-[35%_center]" />
      {/* Okunabilirlik için hafif koyu katman */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/55 via-black/40 to-black/60" />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-balance text-xl font-bold uppercase tracking-wide text-white drop-shadow-md">ÖZN YOL YAPIM İNŞAAT &amp; İŞ MAKİNELERİ</h1>
        </div>
        {/* Şeffaf (buzlu cam) kart: arkaplan görünür kalır; yazılar, alanlar ve düğme koyu zeminde okunaklı olacak şekilde yalnızca bu kartın içinde yeniden renklendirilir. */}
        <div
          className={[
            "rounded-xl border border-white/30 bg-black/30 p-5 text-white shadow-2xl backdrop-blur-md sm:p-6",
            "[&_.text-muted-foreground]:text-white/80!",
            "[&_label]:text-white [&_label]:font-medium",
            "[&_input]:border-white/50! [&_input]:bg-black/25! [&_input]:text-white! [&_input]:placeholder:text-white/60",
            "[&_input]:focus-visible:border-amber-300! [&_input]:focus-visible:ring-amber-300/50!",
            "[&_button[type=submit]]:bg-amber-400! [&_button[type=submit]]:text-neutral-950! [&_button[type=submit]]:font-semibold [&_button[type=submit]]:shadow-md [&_button[type=submit]]:hover:bg-amber-300!",
            "[&_a]:text-white/90! [&_a]:underline [&_a]:underline-offset-4",
            "[&_[role=alert]]:bg-red-950/80! [&_[role=alert]]:text-red-100! [&_[role=alert]]:rounded-lg [&_[role=alert]]:px-2.5 [&_[role=alert]]:py-1.5",
          ].join(" ")}
        >
          {children}
        </div>
      </div>
    </main>
  );
}
