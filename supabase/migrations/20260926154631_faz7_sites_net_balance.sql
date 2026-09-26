-- Şantiye seçim kartları: her şantiyenin toplam gelir/gider (tüm zamanlar), TEK çağrıda. SECURITY INVOKER: RLS geçerli.
CREATE FUNCTION public.get_sites_cash_totals()
RETURNS TABLE (site_id INTEGER, income NUMERIC, expense NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT t.site_id,
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0),
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0)
  FROM public.transactions t
  GROUP BY t.site_id
$$;

REVOKE ALL ON FUNCTION public.get_sites_cash_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sites_cash_totals() TO authenticated, service_role;
