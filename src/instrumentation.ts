/**
 * Sunucu başlarken bir kez çalışır (Next.js instrumentation). Sunucudan Supabase'e giden HTTP bağlantılarını daha uzun
 * canlı tutar: Node varsayılan olarak boşta kalan bağlantıyı 4 sn sonra kapatır; kullanıcı sayfalar arasında genelde
 * 4 sn'den uzun bekler, bu yüzden her geçişte bağlantılar sıfırdan (TCP + TLS el sıkışması) kurulurdu ve bu,
 * veritabanı sorgusunun kendisinden (2-3 ms) çok daha uzun sürüyordu. 30 sn canlı tutulan bağlantılar bu maliyeti ortadan kaldırır.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { Agent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(
    new Agent({
      keepAliveTimeout: 30_000, // boştaki bağlantı 30 sn açık kalır
      keepAliveMaxTimeout: 120_000,
      connect: { timeout: 10_000 },
    }),
  );
}
