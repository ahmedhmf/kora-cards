# KORA PWA — Supabase QR card downloads (no staff or customer login)

KORA uploads the fully rendered 877×1558 KORA player card PNG to a private
Supabase Storage bucket **only when the single combined consent checkbox is checked**.
With the same consent checkbox checked,
KORA stores their name, email, Instagram, telephone, position and shirt number
in the private `public.kora_player_registrations` database table. These are
one combined choice. The raw camera photo is not uploaded. The player's name
and stats are visible within the finished PNG.

## Customer flow

1. Enter player details and **check the combined details-and-card consent box**.
2. Capture/upload photo → ORMBG renders the finished card.
3. The PWA posts the final PNG to a server-side Supabase Edge Function.
4. If upload succeeds, the server returns a **seven-day private signed download URL**.
5. KORA generates a QR code **on the device**. The guest scans it and downloads
   the PNG on their own phone. There are **no staff/customer credentials**.

If the checkbox is unchecked, no cloud upload occurs and no QR is shown.
If cloud storage fails, Save and Print continue to work.

## One-time owner/developer setup (not an event staff login)

1. Create a Supabase project.
2. Run `supabase/kora-cards-storage.sql` in **Supabase SQL Editor**. It creates a
   private bucket, limits files to PNGs smaller than 10 MB, and defines an
   atomic rate-limit function. No public Storage INSERT/SELECT policies.
3. In `src/environments/supabase-storage.config.ts` replace the placeholder
   project URL and **publishable key** (or legacy anon key). These values are
   public; do not put a Supabase secret/service_role key into the PWA.
4. Configure Supabase Edge Function secrets:
   - `KORA_ALLOWED_ORIGINS` — comma-separated exact **PWA origins**
     (e.g., `https://cards.example.com,https://kora.example.com`).
     No trailing slash, no path. Include your localhost origin only for testing.
   - `KORA_RATE_LIMIT_SALT` — unique long random string used to hash rate-limit
     identifiers on the server. Keep it secret.
   - The function uses Supabase's server-provided `SUPABASE_URL` and
     `SUPABASE_SECRET_KEYS` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) to access
     the private bucket. Those server-side credentials are **never sent to users**.
5. Deploy the function with the Supabase CLI:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set KORA_ALLOWED_ORIGINS=https://your-pwa-origin.example KORA_RATE_LIMIT_SALT=REPLACE_WITH_RANDOM_SECRET
   supabase functions deploy kora-card-upload
   ```
   `supabase/config.toml` sets `verify_jwt = false` for this endpoint,
   because guests are not required to log in. **Deploy the function and
   server-side limits before enabling cloud uploads in production.**
6. Rebuild and deploy the PWA. No staff login is shown.

## Fixing browser CORS errors during Angular development

When you run Angular at `http://localhost:4200`, this **exact origin** must
appear in the Edge Function's `KORA_ALLOWED_ORIGINS` secret, alongside the
production PWA origin. Changing the local Angular configuration or publishable
key alone does **not** fix the server-side preflight error.

In the linked Supabase project, set the server environment variable, retaining
your deployed PWA's actual domain:

```bash
supabase secrets set 'KORA_ALLOWED_ORIGINS=http://localhost:4200,https://YOUR_DEPLOYED_PWA_DOMAIN'
```

Then ensure `KORA_RATE_LIMIT_SALT` has been set to a long random value.
Deploy the repository's function (not the Angular app) with:

```bash
supabase functions deploy kora-card-upload --no-verify-jwt
```

The function deliberately has no customer authentication, so Supabase's
platform JWT verification must be disabled. Verify the deployment in
**Supabase Dashboard → Edge Functions → kora-card-upload → Logs / Invocations**.

Test the preflight from a terminal:

```bash
curl -i -X OPTIONS 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/kora-card-upload' \\
  -H 'Origin: http://localhost:4200' \\
  -H 'Access-Control-Request-Method: POST' \\
  -H 'Access-Control-Request-Headers: apikey,content-type,x-kora-consent'
```

Expected: HTTP 200 and `Access-Control-Allow-Origin: http://localhost:4200`.
A 403 means the origin isn't allowed by the deployed function; a 401 suggests
JWT verification; 404 suggests no function deployment; 500/503/502 may mean
a function boot or server error. Check the Supabase Edge Function logs.
Do not set `Access-Control-Allow-Origin: *` as a shortcut.

## Security and operational notes

- The storage bucket is private; the Edge Function uses server credentials to
  upload and sign one temporary download URL. People with the QR URL can
  download that card until the link expires (seven days).
- The endpoint checks an exact browser origin, a consent header, PNG signature,
  expected card dimensions (877×1558), 10 MB size cap and an atomic
  per-source-IP quota of 120 uploads/hour plus a global cap of 2,500 uploads/day. **Origin headers and a consent flag
  are not proof of a trusted or human caller.** Public endpoints can still
  be abused. For a large public deployment, add gateway throttling, a bot
  challenge or a device-specific authentication scheme and usage monitoring.
- No customer or staff login is required to register or upload a card.
  Customer records are only written through the server function when the
  combined player-details-and-finished-card consent is checked. The table has RLS enabled and no
  public select/insert/update/delete policies. The quota table stores salted
  hashes, not raw IPs. Configure an appropriate retention and deletion policy.
- Signed-link expiration **does not delete an image from Supabase**.
  Establish a photo retention/deletion policy (and quota-log cleanup) before
  live events. Delete photos according to the customer's consent terms.
- Online access is required for the PWA to upload and for customers to scan
  and download. Failed uploads are not queued for automatic retry.
- QR codes are generated locally; no third-party QR service sees signed URLs.
- The card is sent as a raw PNG request body. No phone number or original
  image is included in that request. Consented player details use a **separate
  JSON registration request**, never the raw PNG upload.

## Validate before merging

- `npm ci && npm run build`
- Consent checked and unchecked paths
- Supabase Edge Function deployed and bucket confirmed private
- QR opens photo download on a second phone
- Browser-origin restrictions, disallowed MIME/size, quota and internet failure
- Card image still downloadable/printable even on cloud failure
- QR should not appear unless the upload and signed URL succeeded
- Check the Supabase Storage objects and confirm only rendered PNGs are stored
- Test installed PWA and normal mobile browser

## New: saving player details in a private Supabase database

**This feature is not active in the live Supabase project until the database
SQL and Edge Function are deployed.** The existing card upload function is
unchanged and must remain deployed.

1. Run `supabase/kora-player-registration.sql` in the same project's
   **Supabase SQL Editor**. This creates `public.kora_player_registrations`,
   enables RLS and revokes browser-role access to the table. Also make sure
   `supabase/kora-cards-storage.sql` has previously been run so the
   server-side `kora_claim_upload_slot` RPC exists.
2. Deploy the additional Edge Function from the repository root:
   ```powershell
   npx supabase login
   npx supabase link --project-ref lijrppvvwomrvoxtrcaj
   npx supabase functions deploy kora-player-save --no-verify-jwt
   ```
   The function reads the same `KORA_ALLOWED_ORIGINS` and
   `KORA_RATE_LIMIT_SALT` server secrets as `kora-card-upload`. Reuse the
   existing **server-only** Supabase project credentials. Never put service
   secrets in `src/environments/`.
3. In the KORA intro form, enter all six fields and check the **combined
   data-and-finished-card consent checkbox**. Select **Open Camera** or **Upload Photo**. Registration
   is saved before entering the next screen. If it fails, the form displays an
   error so the guest knows their information was not recorded. If the
   **combined checkbox remains unchecked**, no data is saved, no PNG is
   uploaded and no QR code appears.
4. Verify the record in Supabase **Table Editor → kora_player_registrations**,
   or run this administrative SQL query (not from the PWA):
   ```sql
   select created_at, name, email, instagram, telephone,
          position, shirt_number, card_cloud_consent
   from public.kora_player_registrations
   order by created_at desc limit 20;
   ```
   **Treat these records as personal data**, not public kiosk information.
   Restrict Supabase dashboard access to authorized people.

### Privacy and production hardening

- The form uses **one combined opt-in checkbox** for both saving customer
  details and uploading/linking the finished card; it is **not marketing consent**. Provide a clear
  privacy notice identifying KORA as controller, purpose, lawful basis,
  retention period, contact and deletion rights before a live event.
- Decide and implement a deletion schedule. The SQL file includes an example
  90-day retention query, but nothing is deleted automatically until the
  operator configures a job. Card signed URL expiry does not delete card PNGs.
- The public, no-login endpoint uses server-side validation, browser origin
  checks and the existing shared upload quota, but **CORS is not authentication**.
  Add gateway-level bot protection and monitor usage before public deployment.
  Successful registration consumes one quota slot, so events sharing a single
  Wi-Fi/public IP may require quota adjustment.
- Registration stores **one row per consented form submission**; it does not
  deduplicate people by email and does not attach the record ID to their
  exported PNG.

## Linking the finished card image to the customer record

A customer who checks the **single combined consent** for player details and
finished-card cloud storage has their card linked to their record:

1. `kora-player-save` inserts the private registration and returns an
   unguessable session-only linking token; the database stores only its
   SHA-256 digest with a server-side salt.
2. The final PNG goes through the existing `kora-card-upload` function,
   with the link token in the `x-kora-registration-token` header.
3. The Edge Function validates the token and registration's image consent,
   uploads the PNG into the private `kora-cards` bucket, and saves
   `card_storage_path` and `card_uploaded_at` on the matching
   `kora_player_registrations` row.
4. The ordinary seven-day QR signed download URL is still returned to the
   kiosk; this expiring URL is **not** stored in the database.

No linking token is sent when the combined consent is unchecked. In that
case neither player details nor the finished card are uploaded and there
is no QR download. Local card generation, Save and Print still work.

**Required upgrade steps (existing installations):**

1. Re-run `supabase/kora-player-registration.sql` in SQL Editor.
   It contains `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so this also
   upgrades an already-created registrations table without deleting records.
2. Redeploy **both** functions; older deployed versions don't support the
   linking token:
   ```powershell
   npx supabase link --project-ref lijrppvvwomrvoxtrcaj
   npx supabase functions deploy kora-player-save --no-verify-jwt
   npx supabase functions deploy kora-card-upload --no-verify-jwt
   ```
3. Rebuild/refresh the KORA PWA, register a new test player with **the combined**
   checkbox checked, capture a card, and wait for the QR button to activate.
4. Verify the linked private storage path using administrative SQL:
   ```sql
   select created_at, name, email, card_storage_path, card_uploaded_at
   from public.kora_player_registrations
   order by created_at desc limit 20;
   ```
   `card_storage_path` should contain an object key such as
   `2026-11-16/<uuid>.png` in the private `kora-cards` bucket.
   To access the image from an admin application, create a **new signed
   download URL server-side** from this object path. Do not expose service
   credentials or customer records to the PWA.

The new linkage applies only to new registrations using the updated app
and functions; existing unlinked cards aren't retroactively matched
to personal details. The image token is a bearer capability, held in
session state and not saved to localStorage. Protect photo retention and
deletion alongside registration retention: removing a table row **does not**
delete its Storage PNG. This implementation stores one linked card per
registration; further cards should use a new registration or an extended
one-to-many card table.
