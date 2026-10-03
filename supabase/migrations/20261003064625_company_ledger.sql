-- ============================================================
-- ŞİRKET KASASI: her ortağın kendi şirketi için girdiği genel gelir/gider kayıtları.
-- Şantiyeden bağımsızdır (site_id yok). Yalnızca kayıt sahibi ortak yazar/siler; ortak yalnızca kendininkini görür;
-- admin tümünü SALT OKUR. Kâr/zarar yalnızca bu tablodan hesaplanır (genel kasa hareketleri dahil değildir).
-- ============================================================

CREATE TABLE public.company_entries (
  id          SERIAL PRIMARY KEY,
  owner_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entry_type  VARCHAR(10) NOT NULL CHECK (entry_type IN ('income', 'expense')),
  entry_date  DATE NOT NULL,
  description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 2 AND 300),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_entries_owner_date ON public.company_entries (owner_id, entry_date);

ALTER TABLE public.company_entries ENABLE ROW LEVEL SECURITY;

-- Okuma: kayıt sahibi veya admin. Yazma/silme: yalnızca kayıt sahibi ORTAK (admin yazamaz).
CREATE POLICY company_entries_select ON public.company_entries
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR owner_id = (SELECT auth.uid()));

CREATE POLICY company_entries_insert ON public.company_entries
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND NOT (SELECT private.is_admin()));

CREATE POLICY company_entries_update ON public.company_entries
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND NOT (SELECT private.is_admin()))
  WITH CHECK (owner_id = (SELECT auth.uid()) AND NOT (SELECT private.is_admin()));

CREATE POLICY company_entries_delete ON public.company_entries
  FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND NOT (SELECT private.is_admin()));

-- Yetkiler: anon hiçbir şey; owner_id ve created_at güncellenemez.
REVOKE ALL ON public.company_entries FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.company_entries TO authenticated;
GRANT UPDATE (entry_type, entry_date, description, amount) ON public.company_entries TO authenticated;
GRANT USAGE ON SEQUENCE public.company_entries_id_seq TO authenticated;
GRANT ALL ON public.company_entries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.company_entries_id_seq TO service_role;

-- Dönem kâr/zarar özeti: TEK çağrı. SECURITY INVOKER: RLS geçerli (başkasının p_owner'ı için sıfır döner).
CREATE FUNCTION public.get_company_summary(p_owner UUID, p_from DATE, p_to DATE)
RETURNS TABLE (income NUMERIC, expense NUMERIC, entry_count INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(e.amount) FILTER (WHERE e.entry_type = 'income'), 0),
         COALESCE(SUM(e.amount) FILTER (WHERE e.entry_type = 'expense'), 0),
         COUNT(*)::integer
  FROM public.company_entries e
  WHERE e.owner_id = p_owner AND e.entry_date BETWEEN p_from AND p_to
$$;

REVOKE ALL ON FUNCTION public.get_company_summary(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_summary(UUID, DATE, DATE) TO authenticated, service_role;
