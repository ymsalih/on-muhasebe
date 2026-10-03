/**
 * Performans ölçümü için isteğe bağlı fetch sarmalayıcısı. `SUPABASE_TIMING=1` ile başlatılan sunucu,
 * her Supabase çağrısının süresini konsola yazar ("[supabase] 143ms GET /rest/v1/sites").
 * Ortam değişkeni yoksa `undefined` döner ve hiçbir yükü yoktur.
 */
export const debugFetch: typeof fetch | undefined =
  process.env.SUPABASE_TIMING === "1"
    ? async (input, init) => {
        const started = performance.now();
        const res = await fetch(input, init);
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const { pathname, search } = new URL(raw);
        console.log(`[supabase] ${Math.round(performance.now() - started)}ms @${Date.now()} ${init?.method ?? "GET"} ${pathname}${search.slice(0, 60)}`);
        return res;
      }
    : undefined;
