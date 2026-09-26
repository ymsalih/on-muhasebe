-- ============================================================
-- FAZ 5 — attendance (puantaj) + monthly_attendance_summary view + set_attendance RPC
-- ============================================================
-- Şema CLAUDE.md Bölüm 4 ile aynıdır; farklar:
--  * recorded_by UUID (users.id UUID olduğu için).
--  * personnel_id, (personnel_id, site_id) BİLEŞİK yabancı anahtarla bağlıdır: başka şantiyenin personeli
--    bu şantiyenin puantajına yazılamaz. Personel silinirse puantajı da silinir (ON DELETE CASCADE).
--  * Gelecek bir tarihe puantaj yazılamaz (RLS WITH CHECK, Türkiye saatiyle bugün).

CREATE TABLE public.attendance (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  personnel_id  INTEGER NOT NULL,
  work_date     DATE NOT NULL,
  recorded_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (personnel_id, work_date),   -- aynı kişi aynı gün iki kez işaretlenemez
  CONSTRAINT attendance_personnel_same_site_fk
    FOREIGN KEY (personnel_id, site_id) REFERENCES public.personnel (id, site_id) ON DELETE CASCADE
);

CREATE INDEX idx_attendance_site_date ON public.attendance(site_id, work_date);

-- ------------------------------------------------------------
-- YETKİLER (GRANT) + RLS
-- ------------------------------------------------------------
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.attendance FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.attendance TO authenticated;
GRANT UPDATE (note) ON public.attendance TO authenticated;      -- site_id/personnel_id/work_date/recorded_by değiştirilemez
GRANT USAGE ON SEQUENCE public.attendance_id_seq TO authenticated;
GRANT ALL ON public.attendance TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.attendance_id_seq TO service_role;

-- Okuma: şantiye üyeleri (viewer dahil) + admin. Yazma: yalnızca owner/partner (admin ve viewer yazamaz).
CREATE POLICY attendance_select ON public.attendance FOR SELECT TO authenticated
  USING (private.has_site_access(site_id));

CREATE POLICY attendance_insert ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (
    private.can_write_site(site_id)
    AND recorded_by = (SELECT auth.uid())
    AND work_date <= (now() AT TIME ZONE 'Europe/Istanbul')::date
  );

CREATE POLICY attendance_update ON public.attendance FOR UPDATE TO authenticated
  USING (private.can_write_site(site_id)) WITH CHECK (private.can_write_site(site_id));

CREATE POLICY attendance_delete ON public.attendance FOR DELETE TO authenticated
  USING (private.can_write_site(site_id));

-- ------------------------------------------------------------
-- VIEW: aylık puantaj özeti ("kaç gün geldi" → bordro/ödeme hesabının temeli)
-- security_invoker: view'i çağıran kullanıcının RLS'i uygulanır (başka şantiyenin verisi görünmez).
-- ------------------------------------------------------------
CREATE VIEW public.monthly_attendance_summary
WITH (security_invoker = true) AS
SELECT
  personnel_id,
  site_id,
  date_trunc('month', work_date)::date AS month,
  COUNT(*)::integer AS days_worked
FROM public.attendance
GROUP BY personnel_id, site_id, date_trunc('month', work_date);

REVOKE ALL ON public.monthly_attendance_summary FROM anon, authenticated;
GRANT SELECT ON public.monthly_attendance_summary TO authenticated;
GRANT SELECT ON public.monthly_attendance_summary TO service_role;

-- ------------------------------------------------------------
-- RPC: bir günün puantajını tek işlemde güncelle (ekle + çıkar)
-- ------------------------------------------------------------
-- SECURITY INVOKER: RLS aynen geçerli. Tam liste yerine EKLE / ÇIKAR listeleri alır; böylece iki kişi aynı gün
-- aynı anda işaretleme yapsa bile biri diğerinin işaretini silmez. Tekrarlayan ekleme sessizce yok sayılır.
CREATE FUNCTION public.set_attendance(
  p_site_id INTEGER,
  p_work_date DATE,
  p_add INTEGER[] DEFAULT '{}',
  p_remove INTEGER[] DEFAULT '{}'
)
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
  IF cardinality(coalesce(p_add, '{}')) > 1000 OR cardinality(coalesce(p_remove, '{}')) > 1000 THEN
    RAISE EXCEPTION 'Tek seferde en fazla 1000 kişi işlenebilir.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.attendance
  WHERE site_id = p_site_id
    AND work_date = p_work_date
    AND personnel_id = ANY (coalesce(p_remove, '{}'));

  INSERT INTO public.attendance (site_id, personnel_id, work_date, recorded_by)
  SELECT p_site_id, pid, p_work_date, (SELECT auth.uid())
  FROM unnest(coalesce(p_add, '{}')) AS pid
  ON CONFLICT (personnel_id, work_date) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.set_attendance(INTEGER, DATE, INTEGER[], INTEGER[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_attendance(INTEGER, DATE, INTEGER[], INTEGER[]) TO authenticated;
