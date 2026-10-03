-- ============================================================
-- İŞ MAKİNELERİ (kepçe, ekskavatör, kamyon…): makine kartı, günlük puantaj (gün + isteğe bağlı saat) ve kira ödemesi.
-- Şantiye bazlı VE ortağa özel: her ortak, şantiyede yalnızca kendi makinelerini/puantajını görür ve yazar; admin hepsini SALT OKUR.
-- ============================================================

CREATE TABLE public.machines (
  id           SERIAL PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         VARCHAR(150) NOT NULL CHECK (char_length(btrim(name)) >= 2),
  machine_type VARCHAR(20) NOT NULL CHECK (machine_type IN ('kepce', 'ekskavator', 'dozer', 'greyder', 'silindir', 'vinc', 'kamyon', 'beton_pompasi', 'diger')),
  identifier   VARCHAR(50),                                       -- plaka / seri no
  ownership    VARCHAR(10) NOT NULL DEFAULT 'own' CHECK (ownership IN ('own', 'rented')),
  supplier     VARCHAR(150),                                      -- kiralık ise kiralayan firma
  rate_unit    VARCHAR(4) CHECK (rate_unit IN ('day', 'hour')),   -- kira birimi: günlük / saatlik
  rental_rate  NUMERIC(14,2) CHECK (rental_rate IS NULL OR rental_rate >= 0),
  status       VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'left')),
  start_date   DATE,
  end_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, site_id),
  UNIQUE (id, site_id, owner_id),
  CONSTRAINT machines_dates_ok CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT machines_rate_pair CHECK ((rate_unit IS NULL) = (rental_rate IS NULL)),
  CONSTRAINT machines_rate_only_rented CHECK (ownership = 'rented' OR rental_rate IS NULL)
);
CREATE UNIQUE INDEX uq_machines_owner_name ON public.machines (site_id, owner_id, lower(name), lower(COALESCE(identifier, '')));
CREATE INDEX idx_machines_site_owner ON public.machines (site_id, owner_id);

CREATE TABLE public.machine_attendance (
  id          SERIAL PRIMARY KEY,
  site_id     INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  machine_id  INTEGER NOT NULL,
  work_date   DATE NOT NULL,
  hours       NUMERIC(4,1) CHECK (hours IS NULL OR (hours > 0 AND hours <= 24)),
  note        VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (machine_id, work_date),                                  -- aynı makine aynı gün iki kez işaretlenemez
  -- makine aynı şantiyenin VE aynı ortağın olmalı (başkasının makinesine kayıt yazılamaz)
  FOREIGN KEY (machine_id, site_id, owner_id) REFERENCES public.machines (id, site_id, owner_id) ON DELETE CASCADE
);
CREATE INDEX idx_machine_attendance_owner_date ON public.machine_attendance (site_id, owner_id, work_date);

ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY machines_select ON public.machines FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR (site_id IN (SELECT private.member_site_ids()) AND owner_id = (SELECT auth.uid())));
CREATE POLICY machines_insert ON public.machines FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()));
CREATE POLICY machines_update ON public.machines FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()));
CREATE POLICY machines_delete ON public.machines FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()));

CREATE POLICY machine_attendance_select ON public.machine_attendance FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR (site_id IN (SELECT private.member_site_ids()) AND owner_id = (SELECT auth.uid())));
CREATE POLICY machine_attendance_insert ON public.machine_attendance FOR INSERT TO authenticated
  WITH CHECK (
    site_id IN (SELECT private.writable_site_ids())
    AND owner_id = (SELECT auth.uid())
    AND work_date <= (now() AT TIME ZONE 'Europe/Istanbul')::date
  );
CREATE POLICY machine_attendance_update ON public.machine_attendance FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()));
CREATE POLICY machine_attendance_delete ON public.machine_attendance FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()));

REVOKE ALL ON public.machines, public.machine_attendance FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.machines, public.machine_attendance TO authenticated;
GRANT UPDATE (name, machine_type, identifier, ownership, supplier, rate_unit, rental_rate, status, start_date, end_date) ON public.machines TO authenticated;
GRANT UPDATE (hours, note) ON public.machine_attendance TO authenticated;    -- site/ortak/makine/gün değiştirilemez
GRANT USAGE ON SEQUENCE public.machines_id_seq, public.machine_attendance_id_seq TO authenticated;
GRANT ALL ON public.machines, public.machine_attendance TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.machines_id_seq, public.machine_attendance_id_seq TO service_role;

-- Toplu işaretle/kaldır (personel puantajındaki set_attendance gibi: ekle/çıkar listesi, tekrar eklemeler yok sayılır).
CREATE FUNCTION public.set_machine_attendance(p_site_id INTEGER, p_work_date DATE, p_add INTEGER[] DEFAULT '{}', p_remove INTEGER[] DEFAULT '{}')
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.can_write_site(p_site_id) THEN
    RAISE EXCEPTION 'Bu şantiyede puantaj kaydetme yetkiniz yok.' USING ERRCODE = '42501';
  END IF;
  IF p_work_date > (now() AT TIME ZONE 'Europe/Istanbul')::date THEN
    RAISE EXCEPTION 'Gelecek bir tarihe puantaj girilemez.' USING ERRCODE = '22007';
  END IF;
  IF cardinality(coalesce(p_add, '{}')) > 500 OR cardinality(coalesce(p_remove, '{}')) > 500 THEN
    RAISE EXCEPTION 'Tek seferde en fazla 500 makine işlenebilir.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.machine_attendance
  WHERE site_id = p_site_id AND owner_id = (SELECT auth.uid()) AND work_date = p_work_date
    AND machine_id = ANY (coalesce(p_remove, '{}'));

  INSERT INTO public.machine_attendance (site_id, owner_id, machine_id, work_date)
  SELECT p_site_id, (SELECT auth.uid()), mid, p_work_date
  FROM unnest(coalesce(p_add, '{}')) AS mid
  ON CONFLICT (machine_id, work_date) DO NOTHING;
END;
$$;

-- Bir ortağın aylık makine puantajı, makine başına TEK satır: { "2026-10-03": {"h": 8, "n": "not"}, ... }
CREATE FUNCTION public.get_month_machine_attendance(p_site_id INTEGER, p_owner UUID, p_first DATE, p_last DATE)
RETURNS TABLE (machine_id INTEGER, days JSONB)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT a.machine_id,
         jsonb_object_agg(a.work_date::text, jsonb_build_object('h', a.hours, 'n', a.note))
  FROM public.machine_attendance a
  WHERE a.site_id = p_site_id AND a.owner_id = p_owner AND a.work_date BETWEEN p_first AND p_last
  GROUP BY a.machine_id
$$;

-- Şantiyede makinesi olan ortaklar (admin seçicisi için; ortak yalnızca kendini görür).
CREATE FUNCTION public.get_machine_owners(p_site_id INTEGER)
RETURNS TABLE (owner_id UUID, full_name TEXT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT u.id, u.full_name::text FROM public.users u
  WHERE u.id IN (SELECT m.owner_id FROM public.machines m WHERE m.site_id = p_site_id)
  ORDER BY 2
$$;

REVOKE ALL ON FUNCTION public.set_machine_attendance(INTEGER, DATE, INTEGER[], INTEGER[]),
                       public.get_month_machine_attendance(INTEGER, UUID, DATE, DATE),
                       public.get_machine_owners(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_machine_attendance(INTEGER, DATE, INTEGER[], INTEGER[]),
                          public.get_month_machine_attendance(INTEGER, UUID, DATE, DATE),
                          public.get_machine_owners(INTEGER) TO authenticated, service_role;

-- ------------------------------------------------------------
-- KİRA ÖDEMESİ: kasada bir gider; makine + miktar (gün veya saat) × birim kira. Maaş ödemesiyle aynı mantık.
-- ------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN machine_id   INTEGER,
  ADD COLUMN machine_qty  NUMERIC(10,1),
  ADD COLUMN machine_rate NUMERIC(14,2),
  ADD COLUMN machine_unit VARCHAR(4);

ALTER TABLE public.transactions
  -- makine silinirse kira ödemesi varken silinemez (NO ACTION); makine ödemelerden önce silinemez
  ADD CONSTRAINT transactions_machine_same_site_fk FOREIGN KEY (machine_id, site_id) REFERENCES public.machines (id, site_id),
  ADD CONSTRAINT transactions_machine_unit_ok CHECK (machine_unit IS NULL OR machine_unit IN ('day', 'hour')),
  ADD CONSTRAINT transactions_machine_consistent CHECK (
    (machine_qty IS NULL AND machine_rate IS NULL AND machine_unit IS NULL)
    OR (machine_id IS NOT NULL AND machine_qty > 0 AND machine_rate >= 0 AND machine_unit IS NOT NULL
        AND type = 'expense' AND amount = ROUND(machine_qty * machine_rate, 2))
  ),
  ADD CONSTRAINT transactions_machine_only_expense CHECK (machine_id IS NULL OR type = 'expense');

CREATE INDEX idx_transactions_machine ON public.transactions (machine_id, site_id) WHERE machine_id IS NOT NULL;
GRANT UPDATE (machine_id, machine_qty, machine_rate, machine_unit) ON public.transactions TO authenticated;

-- Makine, ödemeyi giren ortağın kendi makinesi olmalı (başkasının makinesine ödeme bağlanamaz).
CREATE FUNCTION private.check_machine_payment()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.machine_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.machines m WHERE m.id = NEW.machine_id AND m.site_id = NEW.site_id AND m.owner_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Makine, ödemeyi giren ortağa ait bir makine olmalı.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_check_machine_payment
  BEFORE INSERT OR UPDATE OF machine_id, user_id, site_id ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.check_machine_payment();
