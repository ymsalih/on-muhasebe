-- ============================================================
-- FATURALARDA KDV
-- ------------------------------------------------------------
-- invoices.amount = KDV HARİÇ tutar (matrah): eski kayıtlar ve "kalan = hakediş − fatura" hesabı değişmez.
-- Yeni sütunlar: kdv_rate (oran, %), kdv_amount (KDV tutarı) ve total_with_kdv (KDV dahil toplam, otomatik hesaplanır).
-- Eski kayıtlar KDV'siz (%0) sayılır. kdv_amount, tutar × oran / 100'ün (kuruşa yuvarlı) en çok 1 kuruş farkıyla uyması gerekir:
-- "KDV dahil" girilen tutarda toplamın girilen tutara kuruşu kuruşuna eşit kalması için KDV, toplamdan geri hesaplanıp saklanır.
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN kdv_rate   NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (kdv_rate >= 0 AND kdv_rate <= 100),
  ADD COLUMN kdv_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (kdv_amount >= 0),
  ADD COLUMN total_with_kdv NUMERIC(14,2) GENERATED ALWAYS AS (amount + kdv_amount) STORED;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_kdv_consistent CHECK (abs(kdv_amount - round(amount * kdv_rate / 100, 2)) <= 0.01);

-- Yeni sütunlar da sahibi tarafından güncellenebilir (toplam otomatiktir, yazılamaz)
GRANT UPDATE (kdv_rate, kdv_amount) ON public.invoices TO authenticated;

-- Ortak toplamları (TEK çağrı): hakediş, fatura (KDV hariç) ve fatura KDV'si
DROP FUNCTION public.get_billing_summary(INTEGER, UUID);
CREATE FUNCTION public.get_billing_summary(p_site_id INTEGER, p_owner UUID)
RETURNS TABLE (kind TEXT, invoice_type TEXT, entry_count INTEGER, total NUMERIC, kdv NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT 'hakedis'::text, NULL::text, COUNT(*)::integer, COALESCE(SUM(p.amount), 0), 0::numeric
  FROM public.progress_payments p
  WHERE p.site_id = p_site_id AND p.created_by = p_owner
  UNION ALL
  SELECT 'fatura'::text, i.invoice_type::text, COUNT(*)::integer, SUM(i.amount), SUM(i.kdv_amount)
  FROM public.invoices i
  WHERE i.site_id = p_site_id AND i.created_by = p_owner
  GROUP BY i.invoice_type
$$;
REVOKE ALL ON FUNCTION public.get_billing_summary(INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_billing_summary(INTEGER, UUID) TO authenticated, service_role;

-- Raporlar: ay bazında hakediş / fatura (KDV hariç) / fatura KDV'si
DROP FUNCTION public.get_billing_report(INTEGER, DATE, DATE);
CREATE FUNCTION public.get_billing_report(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (owner_id UUID, owner_name TEXT, month DATE, progress NUMERIC, invoices NUMERIC, invoice_kdv NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT x.owner_id, COALESCE(u.full_name, '—')::text, x.month, SUM(x.progress), SUM(x.invoices), SUM(x.kdv)
  FROM (
    SELECT p.created_by AS owner_id, date_trunc('month', p.payment_date)::date AS month, p.amount AS progress, 0::numeric AS invoices, 0::numeric AS kdv
    FROM public.progress_payments p WHERE p.site_id = p_site_id AND p.payment_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT i.created_by, date_trunc('month', i.invoice_date)::date, 0::numeric, i.amount, i.kdv_amount
    FROM public.invoices i WHERE i.site_id = p_site_id AND i.invoice_date BETWEEN p_from AND p_to
  ) x
  LEFT JOIN public.users u ON u.id = x.owner_id
  GROUP BY x.owner_id, u.full_name, x.month
  ORDER BY x.month DESC, 2
$$;

DROP FUNCTION public.get_billing_totals(INTEGER);
CREATE FUNCTION public.get_billing_totals(p_site_id INTEGER)
RETURNS TABLE (owner_id UUID, owner_name TEXT, progress NUMERIC, invoices NUMERIC, invoice_kdv NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT o.owner_id, COALESCE(u.full_name, '—')::text, o.progress, o.invoices, o.kdv
  FROM (
    SELECT t.owner_id, SUM(t.progress) AS progress, SUM(t.invoices) AS invoices, SUM(t.kdv) AS kdv
    FROM (
      SELECT p.created_by AS owner_id, p.amount AS progress, 0::numeric AS invoices, 0::numeric AS kdv FROM public.progress_payments p WHERE p.site_id = p_site_id
      UNION ALL
      SELECT i.created_by, 0::numeric, i.amount, i.kdv_amount FROM public.invoices i WHERE i.site_id = p_site_id
    ) t GROUP BY t.owner_id
  ) o
  LEFT JOIN public.users u ON u.id = o.owner_id
  ORDER BY 2
$$;

REVOKE ALL ON FUNCTION public.get_billing_report(INTEGER, DATE, DATE), public.get_billing_totals(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_billing_report(INTEGER, DATE, DATE), public.get_billing_totals(INTEGER) TO authenticated, service_role;

-- Genel özet: dönem fatura KDV'si de eklendi (diğer anahtarlar aynen)
CREATE OR REPLACE FUNCTION public.get_site_overview(p_site_id INTEGER, p_from DATE, p_to DATE)
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
    'invoice_kdv',     (SELECT COALESCE(SUM(kdv_amount), 0) FROM public.invoices WHERE site_id = p_site_id AND invoice_date BETWEEN p_from AND p_to),
    'progress_all',    (SELECT COALESCE(SUM(amount), 0) FROM public.progress_payments WHERE site_id = p_site_id),
    'invoice_all',     (SELECT COALESCE(SUM(amount), 0) FROM public.invoices WHERE site_id = p_site_id)
  )
$$;
