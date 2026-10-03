-- ============================================================
-- HAKEDİŞ ve FATURA (şantiye bazlı, her ortağa özel): alınan hakediş toplamı ile kesilen fatura toplamının denkliği.
-- Kalan fatura = toplam hakediş − toplam fatura (uygulamada hesaplanır; tabloda tutulmaz).
-- Malzeme girişleriyle aynı gizlilik: ortak yalnızca KENDİ kayıtlarını görür/değiştirir; admin hepsini SALT OKUR.
-- ============================================================

CREATE TABLE public.progress_payments (
  id           SERIAL PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  description  VARCHAR(300),                                  -- ör. "1. hakediş"
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_progress_payments_site_owner ON public.progress_payments (site_id, created_by, payment_date DESC);

CREATE TABLE public.invoices (
  id           SERIAL PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  invoice_date DATE NOT NULL,
  invoice_no   VARCHAR(50),
  invoice_type VARCHAR(20) NOT NULL CHECK (invoice_type IN ('malzeme', 'nakliyat', 'yakit', 'iscilik', 'kira', 'diger')),
  description  VARCHAR(300) NOT NULL CHECK (char_length(btrim(description)) >= 2),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_site_owner ON public.invoices (site_id, created_by, invoice_date DESC);

ALTER TABLE public.progress_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- progress_payments
CREATE POLICY progress_payments_select ON public.progress_payments FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR (site_id IN (SELECT private.member_site_ids()) AND created_by = (SELECT auth.uid())));
CREATE POLICY progress_payments_insert ON public.progress_payments FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
CREATE POLICY progress_payments_update ON public.progress_payments FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()))
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
CREATE POLICY progress_payments_delete ON public.progress_payments FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));

-- invoices
CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR (site_id IN (SELECT private.member_site_ids()) AND created_by = (SELECT auth.uid())));
CREATE POLICY invoices_insert ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
CREATE POLICY invoices_update ON public.invoices FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()))
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
CREATE POLICY invoices_delete ON public.invoices FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));

-- Yetkiler: anon yok; site_id ve created_by değiştirilemez.
REVOKE ALL ON public.progress_payments, public.invoices FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.progress_payments, public.invoices TO authenticated;
GRANT UPDATE (payment_date, description, amount) ON public.progress_payments TO authenticated;
GRANT UPDATE (invoice_date, invoice_no, invoice_type, description, amount) ON public.invoices TO authenticated;
GRANT USAGE ON SEQUENCE public.progress_payments_id_seq, public.invoices_id_seq TO authenticated;
GRANT ALL ON public.progress_payments, public.invoices TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.progress_payments_id_seq, public.invoices_id_seq TO service_role;

-- Bir ortağın toplamları, TEK çağrıda (SECURITY INVOKER: RLS geçerli). Hakediş satırı her zaman döner; fatura türe göre kırılır.
CREATE FUNCTION public.get_billing_summary(p_site_id INTEGER, p_owner UUID)
RETURNS TABLE (kind TEXT, invoice_type TEXT, entry_count INTEGER, total NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT 'hakedis'::text, NULL::text, COUNT(*)::integer, COALESCE(SUM(p.amount), 0)
  FROM public.progress_payments p
  WHERE p.site_id = p_site_id AND p.created_by = p_owner
  UNION ALL
  SELECT 'fatura'::text, i.invoice_type::text, COUNT(*)::integer, SUM(i.amount)
  FROM public.invoices i
  WHERE i.site_id = p_site_id AND i.created_by = p_owner
  GROUP BY i.invoice_type
$$;

-- Şantiyede kaydı olan ortaklar (admin ortak seçicisi için; ortak yalnızca kendini görür).
CREATE FUNCTION public.get_billing_owners(p_site_id INTEGER)
RETURNS TABLE (owner_id UUID, full_name TEXT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT u.id, u.full_name::text
  FROM public.users u
  WHERE u.id IN (
    SELECT p.created_by FROM public.progress_payments p WHERE p.site_id = p_site_id
    UNION
    SELECT i.created_by FROM public.invoices i WHERE i.site_id = p_site_id
  )
  ORDER BY 2
$$;

REVOKE ALL ON FUNCTION public.get_billing_summary(INTEGER, UUID), public.get_billing_owners(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_billing_summary(INTEGER, UUID), public.get_billing_owners(INTEGER) TO authenticated, service_role;
