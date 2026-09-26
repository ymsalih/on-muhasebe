-- ============================================================
-- FAZ 8b — Raporlar: dönem bazlı trend, cari ve personel raporları (hepsi TEK çağrıda, SECURITY INVOKER: RLS geçerli)
-- ============================================================

-- Gelir/gider trendi: gün veya ay kırılımında (boş dönemler uygulamada sıfırla doldurulur).
CREATE FUNCTION public.get_cash_trend(p_site_id INTEGER, p_from DATE, p_to DATE, p_bucket TEXT)
RETURNS TABLE (period DATE, income NUMERIC, expense NUMERIC)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_bucket NOT IN ('day', 'month') THEN
    RAISE EXCEPTION 'Geçersiz kırılım' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT date_trunc(p_bucket, t.transaction_date)::date,
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0),
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)
  FROM public.transactions t
  WHERE t.site_id = p_site_id AND t.transaction_date BETWEEN p_from AND p_to
  GROUP BY 1
  ORDER BY 1;
END;
$$;

-- Cari bazlı dönem raporu: faturalanan (irsaliye tutarları), ödenen (gider), tahsil edilen (gelir).
-- Dönemde hiç hareketi olmayan cariler dönmez.
CREATE FUNCTION public.get_party_report(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (party_id INTEGER, name TEXT, category TEXT, invoiced NUMERIC, paid NUMERIC, collected NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT s.party_id, s.name, s.category, s.invoiced, s.paid, s.collected
  FROM (
    SELECT p.id AS party_id, p.name::text AS name, p.category::text AS category,
      COALESCE((SELECT SUM(g.total_amount) FROM public.goods_entries g
                WHERE g.party_id = p.id AND g.site_id = p.site_id AND g.entry_date BETWEEN p_from AND p_to), 0) AS invoiced,
      COALESCE((SELECT SUM(t.amount) FROM public.transactions t
                WHERE t.party_id = p.id AND t.site_id = p.site_id AND t.type = 'expense'
                  AND t.transaction_date BETWEEN p_from AND p_to), 0) AS paid,
      COALESCE((SELECT SUM(t.amount) FROM public.transactions t
                WHERE t.party_id = p.id AND t.site_id = p.site_id AND t.type = 'income'
                  AND t.transaction_date BETWEEN p_from AND p_to), 0) AS collected
    FROM public.parties p
    WHERE p.site_id = p_site_id
  ) s
  WHERE s.invoiced > 0 OR s.paid > 0 OR s.collected > 0
  ORDER BY s.name;
$$;

-- Personel bazlı dönem raporu: çalıştığı gün (puantaj) ve ödenen tutar (maaş ödemeleri). Dönemde ikisi de olmayanlar dönmez.
CREATE FUNCTION public.get_personnel_report(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (personnel_id INTEGER, full_name TEXT, days_worked INTEGER, paid NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT s.personnel_id, s.full_name, s.days_worked, s.paid
  FROM (
    SELECT p.id AS personnel_id, p.full_name::text AS full_name,
      (SELECT COUNT(*) FROM public.attendance a
        WHERE a.personnel_id = p.id AND a.site_id = p.site_id AND a.work_date BETWEEN p_from AND p_to)::integer AS days_worked,
      COALESCE((SELECT SUM(t.amount) FROM public.transactions t
        WHERE t.personnel_id = p.id AND t.site_id = p.site_id AND t.type = 'expense'
          AND t.transaction_date BETWEEN p_from AND p_to), 0) AS paid
    FROM public.personnel p
    WHERE p.site_id = p_site_id
  ) s
  WHERE s.days_worked > 0 OR s.paid > 0
  ORDER BY s.days_worked DESC, s.full_name;
$$;

REVOKE ALL ON FUNCTION public.get_cash_trend(INTEGER, DATE, DATE, TEXT),
                       public.get_party_report(INTEGER, DATE, DATE),
                       public.get_personnel_report(INTEGER, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_trend(INTEGER, DATE, DATE, TEXT),
                          public.get_party_report(INTEGER, DATE, DATE),
                          public.get_personnel_report(INTEGER, DATE, DATE) TO authenticated, service_role;
