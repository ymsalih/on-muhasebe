-- ============================================================
-- CARİ BORÇ KAYITLARI ("borcum" — ör. çelikçiye 100.000 ₺ borç)
-- ------------------------------------------------------------
-- YALNIZCA EKLEYİCİ: yeni tablo + görünüme SONA tek yeni sütun + yeni işlev. Mevcut tablolara, kayıtlara ve mevcut sütunlara dokunulmaz.
-- Cari şantiye bazlıdır (parties ile aynı yetki modeli): şantiyenin owner/partner üyeleri yazar, tüm üyeler ve admin okur.
-- Kalan borç = yazılan borç + faturalanan (irsaliye tutarları) − ödenen (cariye yapılan giderler). Ödeme yapıldıkça kalan borçtan düşer;
-- hesap uygulamada/görünümde canlı yapılır, tabloya bakiye YAZILMAZ.
-- ============================================================

CREATE TABLE public.party_debts (
  id          SERIAL PRIMARY KEY,
  site_id     INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  party_id    INTEGER NOT NULL,
  debt_date   DATE NOT NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  description VARCHAR(300),
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- başka şantiyenin carisine borç yazılamaz; borç kaydı olan cari silinemez (geçmiş korunur)
  FOREIGN KEY (party_id, site_id) REFERENCES public.parties (id, site_id)
);
CREATE INDEX idx_party_debts_party ON public.party_debts (site_id, party_id, debt_date DESC);

ALTER TABLE public.party_debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY party_debts_select ON public.party_debts FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY party_debts_insert ON public.party_debts FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
CREATE POLICY party_debts_update ON public.party_debts FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()))
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY party_debts_delete ON public.party_debts FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

REVOKE ALL ON public.party_debts FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.party_debts TO authenticated;
GRANT UPDATE (debt_date, amount, description) ON public.party_debts TO authenticated;
GRANT USAGE ON SEQUENCE public.party_debts_id_seq TO authenticated;
GRANT ALL ON public.party_debts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.party_debts_id_seq TO service_role;

-- party_balances: mevcut 11 sütun AYNEN kalır; sona yazılan borç toplamı (total_debt) eklenir.
CREATE OR REPLACE VIEW public.party_balances
WITH (security_invoker = true) AS
SELECT
  p.id AS party_id,
  p.site_id,
  p.name,
  p.category,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)  AS total_income,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS total_expense,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0)
    - COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS balance,
  COALESCE(SUM(t.amount), 0) AS total_turnover,
  COUNT(t.id)::integer AS transaction_count,
  MAX(t.transaction_date) AS last_transaction_date,
  (SELECT COALESCE(SUM(g.total_amount), 0) FROM public.goods_entries g
    WHERE g.party_id = p.id AND g.site_id = p.site_id) AS total_invoiced,
  (SELECT COALESCE(SUM(d.amount), 0) FROM public.party_debts d
    WHERE d.party_id = p.id AND d.site_id = p.site_id) AS total_debt
FROM public.parties p
LEFT JOIN public.transactions t ON t.party_id = p.id AND t.site_id = p.site_id
GROUP BY p.id, p.site_id, p.name, p.category;

-- Raporlar: seçili dönemde cari başına yazılan borç (SECURITY INVOKER; RLS geçerli)
CREATE FUNCTION public.get_party_debt_report(p_site_id INTEGER, p_from DATE, p_to DATE)
RETURNS TABLE (party_id INTEGER, total NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT d.party_id, SUM(d.amount)
  FROM public.party_debts d
  WHERE d.site_id = p_site_id AND d.debt_date BETWEEN p_from AND p_to
  GROUP BY d.party_id
$$;
REVOKE ALL ON FUNCTION public.get_party_debt_report(INTEGER, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_party_debt_report(INTEGER, DATE, DATE) TO authenticated, service_role;

-- Şantiye ve ortak silme/arşiv kuralları: borç kayıtları da "veri" sayılır (yanlışlıkla silinmesin)
CREATE OR REPLACE FUNCTION private.site_data_counts(p_site_id INTEGER)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'parties',           (SELECT count(*) FROM public.parties           WHERE site_id = p_site_id),
    'goods_entries',     (SELECT count(*) FROM public.goods_entries     WHERE site_id = p_site_id),
    'personnel',         (SELECT count(*) FROM public.personnel         WHERE site_id = p_site_id),
    'payment_accounts',  (SELECT count(*) FROM public.payment_accounts  WHERE site_id = p_site_id),
    'attendance',        (SELECT count(*) FROM public.attendance        WHERE site_id = p_site_id),
    'transactions',      (SELECT count(*) FROM public.transactions      WHERE site_id = p_site_id),
    'material_entries',  (SELECT count(*) FROM public.material_entries  WHERE site_id = p_site_id),
    'progress_payments', (SELECT count(*) FROM public.progress_payments WHERE site_id = p_site_id),
    'invoices',          (SELECT count(*) FROM public.invoices          WHERE site_id = p_site_id),
    'machines',          (SELECT count(*) FROM public.machines          WHERE site_id = p_site_id),
    'machine_attendance',(SELECT count(*) FROM public.machine_attendance WHERE site_id = p_site_id),
    'fuel_entries',      (SELECT count(*) FROM public.fuel_entries      WHERE site_id = p_site_id),
    'cheques',           (SELECT count(*) FROM public.cheques           WHERE site_id = p_site_id),
    'party_debts',       (SELECT count(*) FROM public.party_debts       WHERE site_id = p_site_id)
  );
$$;

CREATE OR REPLACE FUNCTION private.user_data_counts(p_user_id UUID, p_site_id INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'goods_entries',     (SELECT count(*) FROM public.goods_entries     WHERE created_by  = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'attendance',        (SELECT count(*) FROM public.attendance        WHERE recorded_by = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'transactions',      (SELECT count(*) FROM public.transactions      WHERE user_id     = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'material_entries',  (SELECT count(*) FROM public.material_entries  WHERE created_by  = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'progress_payments', (SELECT count(*) FROM public.progress_payments WHERE created_by  = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'invoices',          (SELECT count(*) FROM public.invoices          WHERE created_by  = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'machines',          (SELECT count(*) FROM public.machines          WHERE owner_id    = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'machine_attendance',(SELECT count(*) FROM public.machine_attendance WHERE owner_id   = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'fuel_entries',      (SELECT count(*) FROM public.fuel_entries      WHERE owner_id    = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'cheques',           (SELECT count(*) FROM public.cheques           WHERE owner_id    = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id)),
    'party_debts',       (SELECT count(*) FROM public.party_debts       WHERE created_by  = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id))
  ) || CASE WHEN p_site_id IS NULL
         THEN jsonb_build_object('company_entries', (SELECT count(*) FROM public.company_entries WHERE owner_id = p_user_id))
         ELSE '{}'::jsonb END;
$$;
