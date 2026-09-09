-- Retire the Services catalog. Its own indexes, policies and trigger are removed
-- with the table. Do not CASCADE: unexpected external dependencies must block this.
-- The shared set_updated_at() function and all other business objects remain.
drop table public.services;
