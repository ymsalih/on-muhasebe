import Image from "next/image";
import panelBg from "@/assets/panelarkaplan.jpg";

/**
 * Panel arkaplanı (giriş ekranıyla uyumlu koyu doku + kabartma logo). Sayfa kaydırılsa da sabit kalır; Next.js görseli
 * ekran boyutuna göre optimize eder. Üstteki gradyan, kartların dışındaki başlık/metinlerin okunurluğunu korur.
 */
export function PanelBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-background">
      <Image src={panelBg} alt="" fill priority sizes="100vw" quality={80} placeholder="blur" className="object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/45" />
    </div>
  );
}
