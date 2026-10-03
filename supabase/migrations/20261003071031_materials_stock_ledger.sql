-- ============================================================
-- MALZEME / STOK DEFTERİ (şantiye bazlı, bağımsız): malzeme kartları + giriş/çıkış hareketleri.
-- Genel kasadan ve irsaliyeden bağımsızdır; tutarlar burada ayrı hesaplanır.
-- Çıkış = şantiyeden başkasına verilen/kullanılan malzeme. Stok eksiye düşemez (tetikleyici, eşzamanlılığa karşı kilitli).
-- ============================================================

CREATE TABLE public.materials (
  id         SERIAL PRIMARY KEY,
  site_id    INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name       VARCHAR(150) NOT NULL CHECK (char_length(btrim(name)) >= 2),
  variant    VARCHAR(150),                 -- cinsi / çeşidi / çapı
  unit       VARCHAR(30) NOT NULL CHECK (char_length(btrim(unit)) >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, site_id)
);
CREATE UNIQUE INDEX uq_materials_site_name_variant
  ON public.materials (site_id, lower(name), lower(COALESCE(variant, '')));

CREATE TABLE public.material_movements (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL,
  material_id   INTEGER NOT NULL,
  movement_type VARCHAR(3) NOT NULL CHECK (movement_type IN ('in', 'out')),
  movement_date DATE NOT NULL,
  quantity      NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
  unit_price    NUMERIC(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),   -- yalnızca girişte (alış fiyatı)
  counterparty  VARCHAR(150),             -- girişte kimden, çıkışta kime verildi
  note          VARCHAR(500),
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT material_movements_out_has_no_price CHECK (movement_type = 'in' OR unit_price IS NULL),
  -- başka şantiyenin malzemesine hareket yazılamaz
  FOREIGN KEY (material_id, site_id) REFERENCES public.materials (id, site_id),
  FOREIGN KEY (site_id) REFERENCES public.sites (id) ON DELETE CASCADE
);
CREATE INDEX idx_material_movements_site_date ON public.material_movements (site_id, movement_date DESC);
CREATE INDEX idx_material_movements_material ON public.material_movements (material_id, site_id);

-- Stok eksiye düşemez. Her etkilenen malzemenin satırı kilitlenir (aynı anda iki çıkış birbirini ezemesin),
-- sonra stok yeniden toplanır. İç içe (CASCADE) silmelerde kontrol atlanır: şantiye silinirken sıra önemsizdir.
CREATE FUNCTION private.check_material_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  mid   integer;
  stock numeric;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  FOR mid IN
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.material_id END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.material_id END
    ]) AS x WHERE x IS NOT NULL ORDER BY x
  LOOP
    PERFORM 1 FROM public.materials WHERE id = mid FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT COALESCE(SUM(CASE WHEN movement_type = 'in' THEN quantity ELSE -quantity END), 0)
      INTO stock FROM public.material_movements WHERE material_id = mid;
    IF stock < 0 THEN
      RAISE EXCEPTION 'Stok eksiye düşemez' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.check_material_stock() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_material_stock
  AFTER INSERT OR UPDATE OR DELETE ON public.material_movements
  FOR EACH ROW EXECUTE FUNCTION private.check_material_stock();

-- RLS (performans deseni: satır başı fonksiyon yok)
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY materials_select ON public.materials FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY materials_insert ON public.materials FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY materials_update ON public.materials FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY materials_delete ON public.materials FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

CREATE POLICY material_movements_select ON public.material_movements FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY material_movements_insert ON public.material_movements FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
CREATE POLICY material_movements_update ON public.material_movements FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY material_movements_delete ON public.material_movements FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

-- Yetkiler: anon yok; site_id/created_by (ve hareketin türü/malzemesi) değiştirilemez.
REVOKE ALL ON public.materials, public.material_movements FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.materials, public.material_movements TO authenticated;
GRANT UPDATE (name, variant, unit) ON public.materials TO authenticated;
GRANT UPDATE (movement_date, quantity, unit_price, counterparty, note) ON public.material_movements TO authenticated;
GRANT USAGE ON SEQUENCE public.materials_id_seq, public.material_movements_id_seq TO authenticated;
GRANT ALL ON public.materials, public.material_movements TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.materials_id_seq, public.material_movements_id_seq TO service_role;

-- Malzeme özeti, TEK çağrıda (SECURITY INVOKER: RLS geçerli).
--  * avg_cost   = fiyatı girilmiş girişlerin ağırlıklı ortalama birim fiyatı (tüm zamanlar)
--  * stock_*    = şu anki stok (tüm girişler − tüm çıkışlar) ve değeri (stok × avg_cost)
--  * period_*   = [p_from, p_to] aralığındaki hareketler; çıkış tutarı = çıkış miktarı × avg_cost
CREATE FUNCTION public.get_material_summary(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (
  material_id INTEGER, name TEXT, variant TEXT, unit TEXT, avg_cost NUMERIC,
  stock_qty NUMERIC, stock_value NUMERIC,
  period_in_qty NUMERIC, period_in_amount NUMERIC, period_out_qty NUMERIC, period_out_amount NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT s.id, s.name, s.variant, s.unit, s.avg_cost,
         s.stock_qty, ROUND(s.stock_qty * s.avg_cost, 2),
         s.p_in_qty, s.p_in_amount, s.p_out_qty, ROUND(s.p_out_qty * s.avg_cost, 2)
  FROM (
    SELECT m.id, m.name::text AS name, m.variant::text AS variant, m.unit::text AS unit,
      COALESCE(SUM(v.quantity * v.unit_price) FILTER (WHERE v.movement_type = 'in' AND v.unit_price IS NOT NULL)
               / NULLIF(SUM(v.quantity) FILTER (WHERE v.movement_type = 'in' AND v.unit_price IS NOT NULL), 0), 0) AS avg_cost,
      COALESCE(SUM(CASE WHEN v.movement_type = 'in' THEN v.quantity ELSE -v.quantity END), 0) AS stock_qty,
      COALESCE(SUM(v.quantity) FILTER (WHERE v.movement_type = 'in' AND v.movement_date BETWEEN p_from AND p_to), 0) AS p_in_qty,
      COALESCE(SUM(v.quantity * v.unit_price) FILTER (WHERE v.movement_type = 'in' AND v.movement_date BETWEEN p_from AND p_to), 0) AS p_in_amount,
      COALESCE(SUM(v.quantity) FILTER (WHERE v.movement_type = 'out' AND v.movement_date BETWEEN p_from AND p_to), 0) AS p_out_qty
    FROM public.materials m
    LEFT JOIN public.material_movements v ON v.material_id = m.id AND v.site_id = m.site_id
    WHERE m.site_id = p_site_id
    GROUP BY m.id, m.name, m.variant, m.unit
  ) s
  ORDER BY s.name, s.variant NULLS FIRST;
$$;

REVOKE ALL ON FUNCTION public.get_material_summary(INTEGER, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_material_summary(INTEGER, DATE, DATE) TO authenticated, service_role;
