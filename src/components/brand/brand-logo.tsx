import Image from "next/image";
import logo from "@/assets/logo.png";
import { cn } from "@/lib/utils";

/** ÖZN YOL logosu (şeffaf PNG). Siyah yol koyu zeminde kaybolduğu için açık renkli bir kutuya yerleştirilir. */
export function BrandLogo({ className, priority, sizes }: { className?: string; priority?: boolean; sizes?: string }) {
  return <Image src={logo} alt="ÖZN YOL logosu" priority={priority} sizes={sizes} className={cn("h-auto w-full", className)} />;
}

/** Logonun beyaz yuvarlak kutusu: giriş sayfasında ve kenar çubuğunda ortak kullanılır. */
export function BrandMark({ className, imgClassName, priority, sizes }: { className?: string; imgClassName?: string; priority?: boolean; sizes?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center bg-white", className)}>
      <BrandLogo className={imgClassName} priority={priority} sizes={sizes} />
    </span>
  );
}
