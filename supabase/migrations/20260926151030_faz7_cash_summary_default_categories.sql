-- ============================================================
-- FAZ 7 — Genel Kasa: site_cash_summary view'i, aralık özeti RPC'si, varsayılan kategoriler
-- ============================================================
-- transactions / categories tabloları Faz 6'da kuruldu; burada raporlama katmanı ve varsayılan veri eklenir.

-- ------------------------------------------------------------
-- Şantiye geneli AYLIK kasa özeti (CLAUDE.md Bölüm 4). security_invoker: çağıranın RLS'i uygulanır.
-- (Rastgele gün aralıkları için aşağıdaki get_cash_summary RPC'si kullanılır; bu view aylık raporlar içindir.)
-- ------------------------------------------------------------
CREATE VIEW public.site_cash_summary
WITH (security_invoker = true) AS
SELECT
  site_id,
  date_trunc('month', transaction_date)::date AS month,
  type,
  category_id,
  SUM(amount) AS total
FROM public.transactions
GROUP BY site_id, date_trunc('month', transaction_date), type, category_id;

REVOKE ALL ON public.site_cash_summary FROM anon, authenticated;
GRANT SELECT ON public.site_cash_summary TO authenticated, service_role;

-- ------------------------------------------------------------
-- RPC: seçilen tarih aralığının gelir/gider toplamları (tür + kategori kırılımıyla), TEK çağrıda.
-- Genel Kasa özet kartları, kategori dağılım grafiği ve dashboard "Bu Ay" kartları bunu kullanır.
-- SECURITY INVOKER: RLS geçerli. İndeks: idx_transactions_site_date (site_id, transaction_date).
-- ------------------------------------------------------------
CREATE FUNCTION public.get_cash_summary(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (type VARCHAR, category_id INTEGER, total NUMERIC, tx_count INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT t.type, t.category_id, SUM(t.amount), COUNT(*)::integer
  FROM public.transactions t
  WHERE t.site_id = p_site_id AND t.transaction_date BETWEEN p_from AND p_to
  GROUP BY t.type, t.category_id;
$$;

REVOKE ALL ON FUNCTION public.get_cash_summary(INTEGER, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_summary(INTEGER, DATE, DATE) TO authenticated;

-- ------------------------------------------------------------
-- Varsayılan kategoriler (site_id NULL = tüm şantiyelerde görünür; ortaklar değiştiremez, yalnızca kendi
-- şantiyeleri için ek kategori açabilir). Tekrar çalıştırılabilir: mevcutsa eklenmez.
-- ------------------------------------------------------------
INSERT INTO public.categories (site_id, name, type)
SELECT NULL, v.name, v.type
FROM (VALUES
  ('Hakediş', 'income'),
  ('Müşteri tahsilatı', 'income'),
  ('Avans', 'income'),
  ('Diğer gelir', 'income'),
  ('Malzeme', 'expense'),
  ('İşçilik', 'expense'),
  ('Nakliye', 'expense'),
  ('Kira (araç / ekipman)', 'expense'),
  ('Yakıt', 'expense'),
  ('Yemek / konaklama', 'expense'),
  ('SGK / vergi', 'expense'),
  ('Genel gider', 'expense'),
  ('Diğer gider', 'expense')
) AS v(name, type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c
  WHERE c.site_id IS NULL AND c.type = v.type AND lower(c.name) = lower(v.name)
);
