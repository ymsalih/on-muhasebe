-- Malzeme girişleri ortaklar arasında PAYLAŞILMAZ: her ortak, şantiyede yalnızca kendi girdiği kayıtları görür,
-- düzenler ve siler (modüler/bağımsız). Admin tüm kayıtları SALT OKUR. Ekleme politikası zaten created_by = auth.uid() ister.
DROP POLICY material_entries_select ON public.material_entries;
DROP POLICY material_entries_update ON public.material_entries;
DROP POLICY material_entries_delete ON public.material_entries;

CREATE POLICY material_entries_select ON public.material_entries FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin())
    OR (site_id IN (SELECT private.member_site_ids()) AND created_by = (SELECT auth.uid()))
  );
CREATE POLICY material_entries_update ON public.material_entries FOR UPDATE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()))
  WITH CHECK (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
CREATE POLICY material_entries_delete ON public.material_entries FOR DELETE TO authenticated
  USING (site_id IN (SELECT private.writable_site_ids()) AND created_by = (SELECT auth.uid()));
