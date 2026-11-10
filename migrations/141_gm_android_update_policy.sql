-- GM_PLAY_UPDATE_V005: MANUAL EXECUTION ONLY on the intended Glomart postgres DB.
-- Existing tables are not modified. No automatic schema execution is authorized.
CREATE TABLE IF NOT EXISTS public.gm_android_update_policy (
    channel text PRIMARY KEY CHECK(channel IN ('DEV','PROD')),
    package_name text NOT NULL,
    latest_version_code integer NOT NULL CHECK(latest_version_code >= 1),
    minimum_version_code integer NOT NULL CHECK(minimum_version_code >= 1 AND minimum_version_code <= latest_version_code),
    latest_version text NOT NULL DEFAULT '',
    apk_url text NOT NULL DEFAULT '',
    play_url text NOT NULL DEFAULT '',
    message text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT false,
    release_ready boolean NOT NULL DEFAULT false,
    force_update boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gm_android_update_policy_package_check CHECK (
      (channel='DEV' AND package_name='com.glomart.app.dev') OR
      (channel='PROD' AND package_name='com.glomart.app')
    )
);
-- No activation, no default rows, no backfill; policy stays disabled until administrator publishes.
