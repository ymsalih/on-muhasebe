import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rapor dışa aktarma (Excel/PDF) paketleri paketlenmeden Node'da doğrudan yüklenir; PDF yazı tipi dosyaları
  // canlıda (Vercel) fonksiyon paketine açıkça eklenir.
  serverExternalPackages: ["exceljs", "pdfmake"],
  outputFileTracingIncludes: {
    "/sites/[siteId]/raporlar/export": ["./node_modules/pdfmake/build/fonts/Roboto/**"],
    "/sites/[siteId]/malzeme/export": ["./node_modules/pdfmake/build/fonts/Roboto/**"],
  },
  experimental: {
    // İstemci yönlendirici önbelleği: 30 sn içinde tekrar ziyaret edilen sayfa (geri/ileri, menü) sunucuya gitmeden
    // anında açılır. Yazma işlemleri (server action + revalidatePath) ve useLiveRefresh önbelleği zaten tazeler;
    // başka kullanıcının değişikliği en geç 30 sn (canlı ekranlarda 15 sn) içinde görünür.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
