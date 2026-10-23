-- GM_GPAY_V113: reusable member transaction PIN storage (payment AND G-PAY transfer)
-- Target database: Glomart PostgreSQL database containing public.gm_member.
-- Additive only. Does not change member passwords, member login, transaction APIs, or existing data.
-- Apply manually to a verified development DB first; do not auto-run in production.
BEGIN;

CREATE TABLE IF NOT EXISTS public.gm_member_payment_pin (
    member_id          VARCHAR(80) PRIMARY KEY,
    pin_hash           TEXT NOT NULL,
    pin_version        BIGINT NOT NULL DEFAULT 1,
    failed_attempts    INTEGER NOT NULL DEFAULT 0,
    locked_until       TIMESTAMPTZ NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_gm_member_payment_pin_member
        FOREIGN KEY (member_id) REFERENCES public.gm_member(member_id),
    CONSTRAINT ck_gm_member_payment_pin_hash_nonempty CHECK (length(btrim(pin_hash)) > 0),
    CONSTRAINT ck_gm_member_payment_pin_version CHECK (pin_version >= 1),
    CONSTRAINT ck_gm_member_payment_pin_failed CHECK (failed_attempts >= 0)
);

COMMENT ON TABLE public.gm_member_payment_pin IS
    'One password-hashed 6-digit transaction PIN per Glomart member; shared by G-PAY payment and transfer';
COMMENT ON COLUMN public.gm_member_payment_pin.pin_hash IS
    'Argon2id encoded password hash of six-digit PIN (salt embedded); NEVER plaintext, encrypted reversible PIN or fast SHA hash';
COMMENT ON COLUMN public.gm_member_payment_pin.pin_version IS
    'Increment upon change/reset so previously issued PIN-based authorization tokens can be invalidated';
COMMENT ON COLUMN public.gm_member_payment_pin.failed_attempts IS
    'Consecutive failures; must be atomically updated/locked by future server PIN verification endpoint';

COMMIT;
