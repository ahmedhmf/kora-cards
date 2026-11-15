# KORA PWA — Supabase QR card downloads (no staff or customer login)

KORA uploads **only the fully rendered 877×1558 KORA player card PNG** to
a private Supabase Storage bucket. It does not upload the original camera
photo, the WhatsApp phone number, or separate player-details records.
The player name and stats are **visible within the finished PNG**.

## Customer flow

1. Enter player details and **check the cloud storage consent box**.
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
- No customer logins, no staff logins and no database row containing user
  details are required. The quota table stores salted hashes, not raw IPs,
  but you still need an appropriate data-retention policy.
- Signed-link expiration **does not delete an image from Supabase**.
  Establish a photo retention/deletion policy (and quota-log cleanup) before
  live events. Delete photos according to the customer's consent terms.
- Online access is required for the PWA to upload and for customers to scan
  and download. Failed uploads are not queued for automatic retry.
- QR codes are generated locally; no third-party QR service sees signed URLs.
- The card is sent as a raw PNG request body. No phone number or original
  image is included in the request.

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
