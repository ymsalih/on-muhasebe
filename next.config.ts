import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // İstemci yönlendirici önbelleği: 30 sn içinde tekrar ziyaret edilen sayfa (geri/ileri, menü) sunucuya gitmeden
    // anında açılır. Yazma işlemleri (server action + revalidatePath) ve useLiveRefresh önbelleği zaten tazeler;
    // başka kullanıcının değişikliği en geç 30 sn (canlı ekranlarda 15 sn) içinde görünür.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
