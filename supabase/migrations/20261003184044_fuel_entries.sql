-- ============================================================
-- YAKIT TAKİBİ: hangi araç (iş makinesi), kim, ne zaman, kaç litre, litre fiyatı; toplam tutar = litre × litre fiyatı (otomatik).
-- Şantiye bazlı VE ortağa özel (makineler gibi): yakıt kaydı ortağın kendi makinesine bağlanır; ortak yalnızca kendi kayıtlarını
-- görür/yazar, admin hepsini SALT OKUR. Kasadan ve diğer modüllerden bağımsızdır.
-- ============================================================

CREATE TABLE public.fuel_entries (
  id           SERIAL PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  machine_id   INTEGER NOT NULL,
  fuel_date    DATE NOT NULL,
  fuel_type    VARCHAR(10) NOT NULL DEFAULT 'motorin' CHECK (fuel_type IN ('motorin', 'benzin', 'lpg', 'diger')),
  liters       NUMERIC(10,2) NOT NULL CHECK (liters > 0),
  unit_price   NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),                     -- ₺ / litre
  total_amount NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(liters * unit_price, 2)) STORED,
  fueled_by    VARCHAR(150),                                                         -- yakıtı kim aldı
  station      VARCHAR(150),                                                         -- istasyon / firma
  note         VARCHAR(300),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- makine aynı şantiyenin VE aynı ortağın olmalı; yakıt kaydı olan makine silinemez (maliyet geçmişi korunur)
  FOREIGN KEY (machine_id, site_id, owner_id) REFERENCES public.machines (id, site_id, owner_id)
);
CREATE INDEX idx_fuel_entries_owner_date ON public.fuel_entries (site_id, owner_id, fuel_date DESC);
CREATE INDEX idx_fuel_entries_machine ON public.fuel_entries (machine_id, site_id, owner_id);

ALTER TABLE public.fuel_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY fuel_entries_select ON public.fuel_entries FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR (site_id IN (SELECT private.member_site_ids()) AND owner_id = (SELECT auth.uid())));
-- Gelecek tarihli yakıt kaydı girilemez (Europe/Istanbul)
CREATE POLICY fuel_entries_insert ON public.fuel_entries FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()) AND fuel_date <= (now() AT TIME ZONE 'Europe/Istanbul')::date);
CREATE POLICY fuel_entries_update ON public.fuel_entries FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()) AND fuel_date <= (now() AT TIME ZONE 'Europe/Istanbul')::date);
CREATE POLICY fuel_entries_delete ON public.fuel_entries FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()));

-- Yetkiler: anon yok; site/ortak ve toplam tutar değiştirilemez (makine düzeltilebilir: bileşik FK sahipliği korur)
REVOKE ALL ON public.fuel_entries FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.fuel_entries TO authenticated;
GRANT UPDATE (machine_id, fuel_date, fuel_type, liters, unit_price, fueled_by, station, note) ON public.fuel_entries TO authenticated;
GRANT USAGE ON SEQUENCE public.fuel_entries_id_seq TO authenticated;
GRANT ALL ON public.fuel_entries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.fuel_entries_id_seq TO service_role;

-- Araç bazında özet (genel toplam bunların toplamıdır), TEK çağrıda. SECURITY INVOKER: RLS geçerli.
-- p_machine boş değilse yalnızca o araç.
CREATE FUNCTION public.get_fuel_summary(p_site_id INTEGER, p_owner UUID, p_from DATE, p_to DATE, p_machine INTEGER DEFAULT NULL)
RETURNS TABLE (machine_id INTEGER, name TEXT, entry_count INTEGER, liters NUMERIC, total NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT m.id, m.name::text, COUNT(f.id)::integer, COALESCE(SUM(f.liters), 0), COALESCE(SUM(f.total_amount), 0)
  FROM public.fuel_entries f
  JOIN public.machines m ON m.id = f.machine_id AND m.site_id = f.site_id
  WHERE f.site_id = p_site_id AND f.owner_id = p_owner AND f.fuel_date BETWEEN p_from AND p_to
    AND (p_machine IS NULL OR f.machine_id = p_machine)
  GROUP BY m.id, m.name
  ORDER BY SUM(f.total_amount) DESC, m.name
$$;

REVOKE ALL ON FUNCTION public.get_fuel_summary(INTEGER, UUID, DATE, DATE, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fuel_summary(INTEGER, UUID, DATE, DATE, INTEGER) TO authenticated, service_role;
