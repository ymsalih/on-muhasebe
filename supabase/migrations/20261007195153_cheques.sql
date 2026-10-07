-- ============================================================
-- ÇEK TAKİBİ
-- ------------------------------------------------------------
-- Şantiye bazlı VE ortağa özel (malzeme, yakıt, makine, hakediş gibi): ortak yalnızca kendi çeklerini görür/yazar;
-- admin hepsini SALT OKUR. Çek, alınan (müşteriden/cariden alınan, tahsil edilecek) ya da verilen (ödenecek) olabilir.
-- Kasadan bağımsızdır; yalnızca vade (ödeme) tarihini, tutarı, kimden/kime ve durumu izler.
-- Durum: pending (bekliyor) → settled (tahsil edildi / ödendi, tarihiyle) | bounced (karşılıksız) | cancelled (iptal).
-- ============================================================

CREATE TABLE public.cheques (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  owner_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  direction     VARCHAR(8) NOT NULL CHECK (direction IN ('received', 'given')),
  counterparty  VARCHAR(150) NOT NULL CHECK (char_length(btrim(counterparty)) >= 2),   -- kimden alındı / kime verildi
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  due_date      DATE NOT NULL,                                                         -- vade = ödeme tarihi
  issue_date    DATE,                                                                  -- düzenleme tarihi (opsiyonel)
  cheque_no     VARCHAR(50),
  bank          VARCHAR(100),
  note          VARCHAR(300),
  status        VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled', 'bounced', 'cancelled')),
  settled_date  DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (issue_date IS NULL OR issue_date <= due_date),
  -- Tahsil/ödeme tarihi yalnızca "settled" durumunda ve o durumda zorunlu
  CHECK ((status = 'settled') = (settled_date IS NOT NULL))
);
CREATE INDEX idx_cheques_owner_due ON public.cheques (site_id, owner_id, status, due_date);
CREATE INDEX idx_cheques_alert ON public.cheques (owner_id, due_date) WHERE status = 'pending';

ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;

CREATE POLICY cheques_select ON public.cheques FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR (site_id IN (SELECT private.member_site_ids()) AND owner_id = (SELECT auth.uid())));
CREATE POLICY cheques_insert ON public.cheques FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()));
CREATE POLICY cheques_update ON public.cheques FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()))
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()));
CREATE POLICY cheques_delete ON public.cheques FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND owner_id = (SELECT auth.uid()));

REVOKE ALL ON public.cheques FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.cheques TO authenticated;
GRANT UPDATE (direction, counterparty, amount, due_date, issue_date, cheque_no, bank, note, status, settled_date) ON public.cheques TO authenticated;
GRANT USAGE ON SEQUENCE public.cheques_id_seq TO authenticated;
GRANT ALL ON public.cheques TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cheques_id_seq TO service_role;

-- ---------- Şantiye ve ortak silme/arşiv kuralları: çekler de "veri" sayılır ----------
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
    'cheques',           (SELECT count(*) FROM public.cheques           WHERE site_id = p_site_id)
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
    'cheques',           (SELECT count(*) FROM public.cheques           WHERE owner_id    = p_user_id AND (p_site_id IS NULL OR site_id = p_site_id))
  ) || CASE WHEN p_site_id IS NULL
         THEN jsonb_build_object('company_entries', (SELECT count(*) FROM public.company_entries WHERE owner_id = p_user_id))
         ELSE '{}'::jsonb END;
$$;

-- ---------- RPC'ler (SECURITY INVOKER: RLS geçerli) ----------
-- Bir ortağın bu şantiyedeki BEKLEYEN çeklerinin özeti, TEK çağrıda. Vade: bugün..bugün+p_days "yaklaşan", bugünden önce "vadesi geçmiş".
-- "Bugün" Europe/Istanbul takvimine göredir.
CREATE FUNCTION public.get_cheque_summary(p_site_id INTEGER, p_owner UUID, p_days INTEGER DEFAULT 7)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH t AS (SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date AS today),
  c AS (
    SELECT c.direction, c.amount, c.due_date, (c.due_date < t.today) AS overdue, (c.due_date BETWEEN t.today AND t.today + p_days) AS soon
    FROM public.cheques c CROSS JOIN t
    WHERE c.site_id = p_site_id AND c.owner_id = p_owner AND c.status = 'pending'
  )
  SELECT jsonb_build_object(
    'received_count', (SELECT COUNT(*) FROM c WHERE direction = 'received'),
    'received_total', (SELECT COALESCE(SUM(amount), 0) FROM c WHERE direction = 'received'),
    'given_count',    (SELECT COUNT(*) FROM c WHERE direction = 'given'),
    'given_total',    (SELECT COALESCE(SUM(amount), 0) FROM c WHERE direction = 'given'),
    'soon_count',     (SELECT COUNT(*) FROM c WHERE soon),
    'soon_received',  (SELECT COALESCE(SUM(amount), 0) FROM c WHERE soon AND direction = 'received'),
    'soon_given',     (SELECT COALESCE(SUM(amount), 0) FROM c WHERE soon AND direction = 'given'),
    'overdue_count',  (SELECT COUNT(*) FROM c WHERE overdue),
    'overdue_received', (SELECT COALESCE(SUM(amount), 0) FROM c WHERE overdue AND direction = 'received'),
    'overdue_given',  (SELECT COALESCE(SUM(amount), 0) FROM c WHERE overdue AND direction = 'given')
  )
$$;

-- Çağıranın KENDİ bekleyen çekleri içinde vadesi yaklaşan veya geçmiş olanlar (uyarılar için): bugün + p_days'e kadar, en yakın vade önce.
-- p_site_id boşsa tüm şantiyeler (şantiye seçim ekranı). Admin çek sahibi olamayacağı için kendi uyarısı yoktur.
CREATE FUNCTION public.get_cheque_alerts(p_site_id INTEGER DEFAULT NULL, p_days INTEGER DEFAULT 7)
RETURNS TABLE (id INTEGER, site_id INTEGER, site_name TEXT, direction TEXT, counterparty TEXT, amount NUMERIC, due_date DATE, days_left INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT c.id, c.site_id, s.name::text, c.direction::text, c.counterparty::text, c.amount, c.due_date, (c.due_date - t.today)::integer
  FROM public.cheques c
  JOIN public.sites s ON s.id = c.site_id
  CROSS JOIN (SELECT (now() AT TIME ZONE 'Europe/Istanbul')::date AS today) t
  WHERE c.owner_id = (SELECT auth.uid()) AND c.status = 'pending'
    AND c.due_date <= t.today + p_days
    AND (p_site_id IS NULL OR c.site_id = p_site_id)
  ORDER BY c.due_date, c.id
  LIMIT 50
$$;

-- Şantiyede çeki olan ortaklar (admin ortak seçicisi için; ortak yalnızca kendini görür)
CREATE FUNCTION public.get_cheque_owners(p_site_id INTEGER)
RETURNS TABLE (owner_id UUID, full_name TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT u.id, u.full_name::text FROM public.users u
  WHERE u.id IN (SELECT c.owner_id FROM public.cheques c WHERE c.site_id = p_site_id)
  ORDER BY 2
$$;

REVOKE ALL ON FUNCTION public.get_cheque_summary(INTEGER, UUID, INTEGER), public.get_cheque_alerts(INTEGER, INTEGER), public.get_cheque_owners(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cheque_summary(INTEGER, UUID, INTEGER), public.get_cheque_alerts(INTEGER, INTEGER), public.get_cheque_owners(INTEGER) TO authenticated, service_role;
