-- ============================================================
-- MALZEME GİRİŞLERİ (şantiye bazlı, bağımsız): alınan her malzemenin maliyeti ve nerede kullanıldığı.
-- Önceki stok/çıkış modeli (materials, material_movements) kaldırıldı (içinde veri yoktu).
-- Maliyet = miktar × birim fiyat (veritabanında otomatik). Genel kasadan ve irsaliyeden bağımsızdır.
-- ============================================================

DROP FUNCTION public.get_material_summary(INTEGER, DATE, DATE);
DROP TABLE public.material_movements;
DROP FUNCTION private.check_material_stock();
DROP TABLE public.materials;

CREATE TABLE public.material_entries (
  id           SERIAL PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  entry_date   DATE NOT NULL,
  name         VARCHAR(150) NOT NULL CHECK (char_length(btrim(name)) >= 2),
  variant      VARCHAR(150),                                             -- cinsi / çeşidi / çapı
  unit         VARCHAR(30) NOT NULL CHECK (char_length(btrim(unit)) >= 1),
  quantity     NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(quantity * unit_price, 2)) STORED,
  supplier     VARCHAR(150),                                             -- kimden alındı
  used_for     VARCHAR(300),                                             -- nerede / ne için kullanıldı (sonradan eklenebilir)
  note         VARCHAR(500),
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_material_entries_site_date ON public.material_entries (site_id, entry_date DESC);
CREATE INDEX idx_material_entries_creator ON public.material_entries (site_id, created_by);

ALTER TABLE public.material_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY material_entries_select ON public.material_entries FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY material_entries_insert ON public.material_entries FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
CREATE POLICY material_entries_update ON public.material_entries FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY material_entries_delete ON public.material_entries FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

-- Yetkiler: anon yok; site_id, created_by ve toplam tutar değiştirilemez.
REVOKE ALL ON public.material_entries FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.material_entries TO authenticated;
GRANT UPDATE (entry_date, name, variant, unit, quantity, unit_price, supplier, used_for, note) ON public.material_entries TO authenticated;
GRANT USAGE ON SEQUENCE public.material_entries_id_seq TO authenticated;
GRANT ALL ON public.material_entries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.material_entries_id_seq TO service_role;

-- Maliyet kırılımı, TEK çağrıda (SECURITY INVOKER: RLS geçerli). p_by: 'partner' (kimin girdiği), 'item' (malzeme), 'usage' (kullanım yeri).
CREATE FUNCTION public.get_material_cost_breakdown(p_site_id INTEGER, p_from DATE, p_to DATE, p_by TEXT)
RETURNS TABLE (group_key TEXT, label TEXT, unit TEXT, entry_count INTEGER, total_quantity NUMERIC, total NUMERIC)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_by NOT IN ('partner', 'item', 'usage') THEN
    RAISE EXCEPTION 'Geçersiz kırılım' USING ERRCODE = '22023';
  END IF;

  IF p_by = 'partner' THEN
    RETURN QUERY
    SELECT COALESCE(e.created_by::text, ''), COALESCE(MAX(u.full_name)::text, 'Bilinmiyor'), NULL::text,
           COUNT(*)::integer, NULL::numeric, SUM(e.total_amount)
    FROM public.material_entries e
    LEFT JOIN public.users u ON u.id = e.created_by
    WHERE e.site_id = p_site_id AND e.entry_date BETWEEN p_from AND p_to
    GROUP BY e.created_by
    ORDER BY 6 DESC;
  ELSIF p_by = 'item' THEN
    RETURN QUERY
    SELECT lower(e.name) || '|' || lower(COALESCE(e.variant, '')) || '|' || lower(e.unit),
           MIN(e.name)::text || CASE WHEN MIN(e.variant) IS NOT NULL THEN ' · ' || MIN(e.variant) ELSE '' END,
           MIN(e.unit)::text, COUNT(*)::integer, SUM(e.quantity), SUM(e.total_amount)
    FROM public.material_entries e
    WHERE e.site_id = p_site_id AND e.entry_date BETWEEN p_from AND p_to
    GROUP BY lower(e.name), lower(COALESCE(e.variant, '')), lower(e.unit)
    ORDER BY 6 DESC;
  ELSE
    RETURN QUERY
    SELECT lower(COALESCE(btrim(e.used_for), '')),
           COALESCE(NULLIF(MIN(btrim(e.used_for)), ''), 'Belirtilmemiş')::text, NULL::text,
           COUNT(*)::integer, NULL::numeric, SUM(e.total_amount)
    FROM public.material_entries e
    WHERE e.site_id = p_site_id AND e.entry_date BETWEEN p_from AND p_to
    GROUP BY lower(COALESCE(btrim(e.used_for), ''))
    ORDER BY 6 DESC;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_material_cost_breakdown(INTEGER, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_material_cost_breakdown(INTEGER, DATE, DATE, TEXT) TO authenticated, service_role;
