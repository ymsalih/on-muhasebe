-- service_role RLS'i atlar ama tablo yetkisi (GRANT) yine gerekir; yeni projelerde otomatik verilmiyor.
GRANT ALL ON public.users, public.sites, public.site_members TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sites_id_seq, public.site_members_id_seq TO service_role;
