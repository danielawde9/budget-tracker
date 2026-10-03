-- Baseline part 9 of 9: seed. The household invitation signing keys (was an insert in the old
-- 20260908170000 migration). Random per database, so created here and never copied from another.
insert into private.household_invitation_keys (key_version, identity_hmac_key, token_hmac_key)
values (1, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32));
