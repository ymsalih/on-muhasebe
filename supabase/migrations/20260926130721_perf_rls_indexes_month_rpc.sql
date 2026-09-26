-- ============================================================
-- PERFORMANS — RLS tek seferlik alt sorguya, indeksler, aylık puantaj RPC'si
-- ============================================================
-- Sorun: politikalar `private.has_site_access(site_id)` gibi satır başına çağrılan fonksiyonlar kullanıyordu;
-- fonksiyon her satır için ayrı çalışıyordu (3.900 satırlık puantaj sorgusu: 478 ms, satır başına ~0,12 ms).
-- Çözüm: kullanıcının şantiye kimliklerini TEK sefer üreten (uncorrelated) alt sorgu:
--   site_id IN (SELECT private.member_site_ids())   ← InitPlan/hash: sorgu başına bir kez çalışır
--   (SELECT private.is_admin())                     ← sorgu başına bir kez
-- Anlamlar (kim neyi görür/yazar) DEĞİŞMEZ; mevcut RLS testleri aynen geçmelidir.

-- ------------------------------------------------------------
-- Küme döndüren yardımcılar (private: API'ye açılmaz)
-- ------------------------------------------------------------
CREATE FUNCTION private.member_site_ids()
RETURNS SETOF INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT site_id FROM public.site_members WHERE user_id = (SELECT auth.uid());
$$;

CREATE FUNCTION private.writable_site_ids()
RETURNS SETOF INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT site_id FROM public.site_members
  WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'partner');
$$;

CREATE FUNCTION private.owner_site_ids()
RETURNS SETOF INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT site_id FROM public.site_members
  WHERE user_id = (SELECT auth.uid()) AND role = 'owner';
$$;

REVOKE ALL ON FUNCTION private.member_site_ids(), private.writable_site_ids(), private.owner_site_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.member_site_ids(), private.writable_site_ids(), private.owner_site_ids() TO authenticated;

-- ------------------------------------------------------------
-- Politikalar (eski adlarıyla, aynı anlamla)
-- ------------------------------------------------------------
-- sites: görme
DROP POLICY sites_select ON public.sites;
CREATE POLICY sites_select ON public.sites FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin())
    OR id IN (SELECT private.member_site_ids())
    OR (created_by = (SELECT auth.uid()) AND NOT private.site_has_members(id))
  );

-- parties
DROP POLICY parties_select ON public.parties;
DROP POLICY parties_insert ON public.parties;
DROP POLICY parties_update ON public.parties;
DROP POLICY parties_delete ON public.parties;
CREATE POLICY parties_select ON public.parties FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY parties_insert ON public.parties FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY parties_update ON public.parties FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY parties_delete ON public.parties FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

-- goods_entries
DROP POLICY goods_entries_select ON public.goods_entries;
DROP POLICY goods_entries_insert ON public.goods_entries;
DROP POLICY goods_entries_update ON public.goods_entries;
DROP POLICY goods_entries_delete ON public.goods_entries;
CREATE POLICY goods_entries_select ON public.goods_entries FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY goods_entries_insert ON public.goods_entries FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
CREATE POLICY goods_entries_update ON public.goods_entries FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY goods_entries_delete ON public.goods_entries FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

-- personnel (silme yalnızca şantiye sahibi)
DROP POLICY personnel_select ON public.personnel;
DROP POLICY personnel_insert ON public.personnel;
DROP POLICY personnel_update ON public.personnel;
DROP POLICY personnel_delete ON public.personnel;
CREATE POLICY personnel_select ON public.personnel FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY personnel_insert ON public.personnel FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY personnel_update ON public.personnel FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY personnel_delete ON public.personnel FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.owner_site_ids()));

-- payment_accounts
DROP POLICY payment_accounts_select ON public.payment_accounts;
DROP POLICY payment_accounts_insert ON public.payment_accounts;
DROP POLICY payment_accounts_update ON public.payment_accounts;
DROP POLICY payment_accounts_delete ON public.payment_accounts;
CREATE POLICY payment_accounts_select ON public.payment_accounts FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY payment_accounts_insert ON public.payment_accounts FOR INSERT TO authenticated
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY payment_accounts_update ON public.payment_accounts FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY payment_accounts_delete ON public.payment_accounts FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

-- attendance
DROP POLICY attendance_select ON public.attendance;
DROP POLICY attendance_insert ON public.attendance;
DROP POLICY attendance_update ON public.attendance;
DROP POLICY attendance_delete ON public.attendance;
CREATE POLICY attendance_select ON public.attendance FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()) OR site_id IN (SELECT private.member_site_ids()));
CREATE POLICY attendance_insert ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (
    site_id IN (SELECT private.writable_site_ids())
    AND recorded_by = (SELECT auth.uid())
    AND work_date <= (now() AT TIME ZONE 'Europe/Istanbul')::date
  );
CREATE POLICY attendance_update ON public.attendance FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids())) WITH CHECK (site_id IN (SELECT private.writable_site_ids()));
CREATE POLICY attendance_delete ON public.attendance FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()));

-- ------------------------------------------------------------
-- İNDEKSLER
-- ------------------------------------------------------------
-- goods_entries: (site_id) tek başına, (site_id, entry_date DESC) tarafından kapsanıyordu → kaldır.
-- party_id indeksi bileşik yabancı anahtarı (party_id, site_id) kapsayacak şekilde genişletildi.
DROP INDEX public.idx_goods_entries_site;
DROP INDEX public.idx_goods_entries_party;
CREATE INDEX idx_goods_entries_party_site ON public.goods_entries (party_id, site_id);
CREATE INDEX idx_goods_entries_created_by ON public.goods_entries (created_by);

-- personnel: liste (site_id, full_name) sıralı okunur → (site_id) indeksinin yerine.
DROP INDEX public.idx_personnel_site;
CREATE INDEX idx_personnel_site_name ON public.personnel (site_id, full_name);
CREATE INDEX idx_personnel_employer_party ON public.personnel (employer_party_id, site_id);

-- payment_accounts: bileşik yabancı anahtarlar
CREATE INDEX idx_payment_accounts_personnel ON public.payment_accounts (personnel_id, site_id);
CREATE INDEX idx_payment_accounts_party ON public.payment_accounts (party_id, site_id);

-- attendance: recorded_by (kullanıcı silinirken SET NULL taraması). (personnel_id, site_id) yabancı anahtarı,
-- UNIQUE (personnel_id, work_date) indeksinin ön ekiyle zaten kapsanır; ayrıca indeks eklenmedi (yazma maliyeti).
CREATE INDEX idx_attendance_recorded_by ON public.attendance (recorded_by);

CREATE INDEX idx_sensitive_access_log_user ON public.sensitive_access_log (user_id);

-- ------------------------------------------------------------
-- RPC: bir ayın puantajı TEK çağrıda, kişi başına toplu (satır satır değil)
-- ------------------------------------------------------------
-- Önceki yöntem: 1000'erli sayfalarla art arda N istek (+ özet view'i için bir istek). Bu fonksiyon kişi başına
-- tek satır döner: işaretli günler (date[]) ve notlar (jsonb). Toplam = cardinality(days). SECURITY INVOKER: RLS geçerli.
CREATE FUNCTION public.get_month_attendance(p_site_id INTEGER, p_first DATE, p_last DATE)
RETURNS TABLE (personnel_id INTEGER, days DATE[], notes JSONB)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    a.personnel_id,
    array_agg(a.work_date ORDER BY a.work_date),
    coalesce(jsonb_object_agg(a.work_date::text, a.note) FILTER (WHERE a.note IS NOT NULL), '{}'::jsonb)
  FROM public.attendance a
  WHERE a.site_id = p_site_id AND a.work_date BETWEEN p_first AND p_last
  GROUP BY a.personnel_id;
$$;

REVOKE ALL ON FUNCTION public.get_month_attendance(INTEGER, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_month_attendance(INTEGER, DATE, DATE) TO authenticated;
