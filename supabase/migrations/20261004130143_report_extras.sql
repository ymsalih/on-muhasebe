-- ============================================================
-- RAPORLAR GENİŞLETME: yakıt, makine, hakediş/fatura ve tüm şantiye özeti
-- ------------------------------------------------------------
-- Hepsi SECURITY INVOKER: satır görünürlüğünü RLS belirler. Ortağa özel tablolar (yakıt, makine, malzeme, hakediş, fatura)
-- için ortak yalnızca KENDİ kayıtlarını görür; admin hepsini (ortak ortak) salt okur; şantiyeye üye olmayan hiçbir şey görmez.
-- ============================================================

-- Yakıt: ortak ve araç bazında litre / tutar
CREATE FUNCTION public.get_fuel_report(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (owner_id UUID, owner_name TEXT, machine_id INTEGER, machine_name TEXT, identifier TEXT, entry_count INTEGER, liters NUMERIC, total NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT f.owner_id, COALESCE(u.full_name, '—')::text, m.id, m.name::text, m.identifier::text,
         COUNT(*)::integer, SUM(f.liters), SUM(f.total_amount)
  FROM public.fuel_entries f
  JOIN public.machines m ON m.id = f.machine_id AND m.site_id = f.site_id
  LEFT JOIN public.users u ON u.id = f.owner_id
  WHERE f.site_id = p_site_id AND f.fuel_date BETWEEN p_from AND p_to
  GROUP BY f.owner_id, u.full_name, m.id, m.name, m.identifier
  ORDER BY SUM(f.total_amount) DESC, m.name
$$;

-- Makine: dönemdeki çalışma (gün / saat), kiralık makinede hesaplanan kira ve dönemde ödenen kira
CREATE FUNCTION public.get_machine_report(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (owner_id UUID, owner_name TEXT, machine_id INTEGER, machine_name TEXT, identifier TEXT, ownership TEXT,
               rate_unit TEXT, rental_rate NUMERIC, days INTEGER, hours NUMERIC, due NUMERIC, paid NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT * FROM (
    SELECT m.owner_id AS owner_id, COALESCE(u.full_name, '—')::text AS owner_name, m.id AS machine_id, m.name::text AS machine_name,
           m.identifier::text AS identifier, m.ownership::text AS ownership, m.rate_unit::text AS rate_unit, m.rental_rate AS rental_rate,
           COALESCE(a.days, 0)::integer AS days, COALESCE(a.hours, 0) AS hours,
           CASE WHEN m.ownership = 'rented' AND m.rental_rate IS NOT NULL
                THEN ROUND(CASE m.rate_unit WHEN 'day' THEN COALESCE(a.days, 0) * m.rental_rate
                                            WHEN 'hour' THEN COALESCE(a.hours, 0) * m.rental_rate ELSE 0 END, 2)
                ELSE 0 END AS due,
           COALESCE(p.paid, 0) AS paid
    FROM public.machines m
    LEFT JOIN public.users u ON u.id = m.owner_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS days, SUM(ma.hours) AS hours FROM public.machine_attendance ma
      WHERE ma.machine_id = m.id AND ma.site_id = m.site_id AND ma.owner_id = m.owner_id AND ma.work_date BETWEEN p_from AND p_to
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT SUM(t.amount) AS paid FROM public.transactions t
      WHERE t.machine_id = m.id AND t.site_id = m.site_id AND t.type = 'expense' AND t.transaction_date BETWEEN p_from AND p_to
    ) p ON true
    WHERE m.site_id = p_site_id
  ) r
  WHERE r.days > 0 OR r.paid > 0
  ORDER BY r.paid DESC, r.machine_name
$$;

-- Hakediş / fatura: ortak ve ay bazında (dönem)
CREATE FUNCTION public.get_billing_report(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (owner_id UUID, owner_name TEXT, month DATE, progress NUMERIC, invoices NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT x.owner_id, COALESCE(u.full_name, '—')::text, x.month, SUM(x.progress), SUM(x.invoices)
  FROM (
    SELECT p.created_by AS owner_id, date_trunc('month', p.payment_date)::date AS month, p.amount AS progress, 0::numeric AS invoices
    FROM public.progress_payments p WHERE p.site_id = p_site_id AND p.payment_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT i.created_by, date_trunc('month', i.invoice_date)::date, 0::numeric, i.amount
    FROM public.invoices i WHERE i.site_id = p_site_id AND i.invoice_date BETWEEN p_from AND p_to
  ) x
  LEFT JOIN public.users u ON u.id = x.owner_id
  GROUP BY x.owner_id, u.full_name, x.month
  ORDER BY x.month DESC, 2
$$;

-- Hakediş / fatura: ortak başına TÜM ZAMANLARIN toplamı (kalan = hakediş − fatura)
CREATE FUNCTION public.get_billing_totals(p_site_id INTEGER)
RETURNS TABLE (owner_id UUID, owner_name TEXT, progress NUMERIC, invoices NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT o.owner_id, COALESCE(u.full_name, '—')::text, o.progress, o.invoices
  FROM (
    SELECT t.owner_id, SUM(t.progress) AS progress, SUM(t.invoices) AS invoices
    FROM (
      SELECT p.created_by AS owner_id, p.amount AS progress, 0::numeric AS invoices FROM public.progress_payments p WHERE p.site_id = p_site_id
      UNION ALL
      SELECT i.created_by, 0::numeric, i.amount FROM public.invoices i WHERE i.site_id = p_site_id
    ) t GROUP BY t.owner_id
  ) o
  LEFT JOIN public.users u ON u.id = o.owner_id
  ORDER BY 2
$$;

-- Tüm şantiye özeti: dönemdeki rakamlar TEK çağrıda (kasa, personel, irsaliye, malzeme, yakıt, makine, hakediş/fatura)
CREATE FUNCTION public.get_site_overview(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'cash_income',     (SELECT COALESCE(SUM(amount), 0) FROM public.transactions WHERE site_id = p_site_id AND type = 'income'  AND transaction_date BETWEEN p_from AND p_to),
    'cash_expense',    (SELECT COALESCE(SUM(amount), 0) FROM public.transactions WHERE site_id = p_site_id AND type = 'expense' AND transaction_date BETWEEN p_from AND p_to),
    'cash_count',      (SELECT COUNT(*) FROM public.transactions WHERE site_id = p_site_id AND transaction_date BETWEEN p_from AND p_to),
    'wage_paid',       (SELECT COALESCE(SUM(amount), 0) FROM public.transactions WHERE site_id = p_site_id AND type = 'expense' AND personnel_id IS NOT NULL AND transaction_date BETWEEN p_from AND p_to),
    'rent_paid',       (SELECT COALESCE(SUM(amount), 0) FROM public.transactions WHERE site_id = p_site_id AND type = 'expense' AND machine_id IS NOT NULL AND transaction_date BETWEEN p_from AND p_to),
    'personnel_total', (SELECT COUNT(*) FROM public.personnel WHERE site_id = p_site_id),
    'attendance_days', (SELECT COUNT(*) FROM public.attendance WHERE site_id = p_site_id AND work_date BETWEEN p_from AND p_to),
    'attendance_people', (SELECT COUNT(DISTINCT personnel_id) FROM public.attendance WHERE site_id = p_site_id AND work_date BETWEEN p_from AND p_to),
    'party_count',     (SELECT COUNT(*) FROM public.parties WHERE site_id = p_site_id),
    'goods_count',     (SELECT COUNT(*) FROM public.goods_entries WHERE site_id = p_site_id AND entry_date BETWEEN p_from AND p_to),
    'goods_total',     (SELECT COALESCE(SUM(total_amount), 0) FROM public.goods_entries WHERE site_id = p_site_id AND entry_date BETWEEN p_from AND p_to),
    'goods_transport', (SELECT COALESCE(SUM(transport_cost), 0) FROM public.goods_entries WHERE site_id = p_site_id AND entry_date BETWEEN p_from AND p_to),
    'material_count',  (SELECT COUNT(*) FROM public.material_entries WHERE site_id = p_site_id AND entry_date BETWEEN p_from AND p_to),
    'material_total',  (SELECT COALESCE(SUM(total_amount), 0) FROM public.material_entries WHERE site_id = p_site_id AND entry_date BETWEEN p_from AND p_to),
    'fuel_count',      (SELECT COUNT(*) FROM public.fuel_entries WHERE site_id = p_site_id AND fuel_date BETWEEN p_from AND p_to),
    'fuel_liters',     (SELECT COALESCE(SUM(liters), 0) FROM public.fuel_entries WHERE site_id = p_site_id AND fuel_date BETWEEN p_from AND p_to),
    'fuel_total',      (SELECT COALESCE(SUM(total_amount), 0) FROM public.fuel_entries WHERE site_id = p_site_id AND fuel_date BETWEEN p_from AND p_to),
    'machine_days',    (SELECT COUNT(*) FROM public.machine_attendance WHERE site_id = p_site_id AND work_date BETWEEN p_from AND p_to),
    'machine_hours',   (SELECT COALESCE(SUM(hours), 0) FROM public.machine_attendance WHERE site_id = p_site_id AND work_date BETWEEN p_from AND p_to),
    'progress_total',  (SELECT COALESCE(SUM(amount), 0) FROM public.progress_payments WHERE site_id = p_site_id AND payment_date BETWEEN p_from AND p_to),
    'invoice_total',   (SELECT COALESCE(SUM(amount), 0) FROM public.invoices WHERE site_id = p_site_id AND invoice_date BETWEEN p_from AND p_to),
    'progress_all',    (SELECT COALESCE(SUM(amount), 0) FROM public.progress_payments WHERE site_id = p_site_id),
    'invoice_all',     (SELECT COALESCE(SUM(amount), 0) FROM public.invoices WHERE site_id = p_site_id)
  )
$$;

REVOKE ALL ON FUNCTION public.get_fuel_report(INTEGER, DATE, DATE), public.get_machine_report(INTEGER, DATE, DATE),
  public.get_billing_report(INTEGER, DATE, DATE), public.get_billing_totals(INTEGER), public.get_site_overview(INTEGER, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fuel_report(INTEGER, DATE, DATE), public.get_machine_report(INTEGER, DATE, DATE),
  public.get_billing_report(INTEGER, DATE, DATE), public.get_billing_totals(INTEGER), public.get_site_overview(INTEGER, DATE, DATE) TO authenticated, service_role;
