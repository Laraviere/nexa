-- Hosted projects may not automatically grant table privileges. Local defaults
-- may grant too much, including DELETE and TRUNCATE. Set the exact privileges
-- required by Customers, independently of either environment's defaults.
-- RLS and existing policies continue to control row access.
revoke all privileges on table public.customers from authenticated;
grant select, insert, update on table public.customers to authenticated;
