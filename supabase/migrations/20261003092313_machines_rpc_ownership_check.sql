-- set_machine_attendance: işaretlenecek her makine çağıran ortağın kendi makinesi olmalı.
-- (Aksi halde ON CONFLICT DO NOTHING çakışmada hata vermez; başkasının makinesinin o gün işaretli olup olmadığı hata/başarı farkından sızardı.)
-- machines RLS'i yalnızca kendi makinelerini gösterir.
CREATE OR REPLACE FUNCTION public.set_machine_attendance(p_site_id INTEGER, p_work_date DATE, p_add INTEGER[] DEFAULT '{}', p_remove INTEGER[] DEFAULT '{}')
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

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_add, '{}')) AS mid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.machines m WHERE m.id = mid AND m.site_id = p_site_id AND m.owner_id = (SELECT auth.uid())
    )
  ) THEN
    RAISE EXCEPTION 'Makine bulunamadı.' USING ERRCODE = '23503';
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
