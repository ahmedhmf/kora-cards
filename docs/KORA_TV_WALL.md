# KORA Event TV Wall — 4×4 card display

## What it does

Open `/wall` on the deployed KORA PWA (for example,
`https://kora-cards.vercel.app/wall`). The photo-booth stays at `/`.

- Shows **16 card slots in a 4×4 grid** suitable for landscape TV displays.
- Automatically flips one tile to a different card every 3.5 seconds,
  continually cycling through the available event-approved cards.
- Checks for new cards every 30 seconds and refreshes the full collection and\n  signed download URLs approximately every 4 minutes.
- Pages through the server's data in groups of 80, supporting large events.
- Displays a **separate QR code next to each photo** in the 4×4 wall, on
  both sides of a flipping tile. Each QR opens that specific finished card.
  Click/tap a small QR to show a **larger scan-friendly QR and card**.
- QR images are generated locally using KORA's existing QR utility, so no
  external QR provider receives private signed download URLs.
- Wall QR codes use short-lived signed URLs (currently 10 minutes) and are
  refreshed in the background. Because the TV has 16 cards on screen, QR
  readability depends on screen size and viewing distance; use the enlarge
  view for reliable scanning from farther away.
- Has a browser fullscreen control and a **LOCK** button to clear the access code.
- When fewer than 16 cards have arrived, unused slots show KORA branding.
- Only shows the **finished PNG**, never any name, email, telephone, Instagram
  or other database fields separately. Cards themselves may visually contain
  the player name, score or other personal information.

## Privacy / consent

The single checkbox on the photo-booth form now explicitly covers:
1. Saving the customer's registration details in the private database.
2. Saving and linking the finished player card in private cloud storage.
3. **Displaying the finished card on an event TV screen**.

The database column `event_screen_consent` defaults to **false**.
Existing records stay false and **must not** automatically appear on TV.
Only new records whose customers saw and accepted the updated consent wording
are eligible. Do not backfill permission without the person's agreement.

A new server-side-only secret `KORA_WALL_ACCESS_KEY` protects the wall feed.
The operator types this into the wall screen. It stays only in the current tab's
`sessionStorage` so a reload works; **do not include it in query parameters,
Vercel env variables intended for Angular, or source control**. Lock the
screen between events. Signed image URLs are valid for 10 minutes and are
renewed periodically. A code grants access to the event images, so treat it as
a credential and rotate it between events.

The backend returns only a private bucket object identifier and a short-lived
signed URL for each consented card. Database rows are never readable from the
public PWA. The existing seven-day guest QR download behavior is unchanged.

## One-time Supabase setup

**Before deploying the TV wall:**

1. Run the updated `supabase/kora-player-registration.sql` in **Supabase SQL
   Editor**. It adds `event_screen_consent boolean not null default false`
   safely to an existing table without exposing historical cards.
2. Set a **random** 24+ character TV access code using Supabase secrets.
   Example below uses a placeholder; replace it with your own random value:
   ```powershell
   npx supabase link --project-ref lijrppvvwomrvoxtrcaj
   npx supabase secrets set "KORA_WALL_ACCESS_KEY=REPLACE_WITH_RANDOM_LONG_EVENT_CODE"
   ```
3. Confirm `KORA_ALLOWED_ORIGINS` includes your actual Vercel site origin
   `https://kora-cards.vercel.app` and (for development) `http://localhost:4200`.
   It is a comma-separated list of full origins without trailing slashes.
4. Deploy the two changed/new functions:
   ```powershell
   npx supabase functions deploy kora-player-save --no-verify-jwt
   npx supabase functions deploy kora-wall-feed --no-verify-jwt
   ```
   The pre-existing `kora-card-upload` function needs no change for this
   TV feature and continues linking uploaded images to their records.
5. Deploy the Angular frontend branch to Vercel. The new `vercel.json`
   rewrites `/wall` to `index.html`; Angular selects the TV component by
   pathname, so the photo-booth's camera/store doesn't initialize on the TV.

### Test

1. Open `http://localhost:4200/wall` or a deployed `/wall` route.
2. Enter the event code set in Supabase (not a Supabase publishable or secret key).
3. Open the regular `/` route on a different phone and complete a registration
   with the new combined consent; take a photo and wait for the QR.
4. Within one refresh interval (~30 seconds), the new card should appear on TV.
5. Create 17+ approved cards or use approved test registrations to check
   that a card flips to reveal additional photos.
6. Check that a pre-existing registration with
   `event_screen_consent=false` is **not** shown.
7. Check invalid access codes are rejected and the LOCK control removes the
   session code.

Query to verify consent and card path **as an authorized operator only**:
```sql
select created_at, event_screen_consent, card_storage_path
from public.kora_player_registrations
order by created_at desc limit 30;
```

### Operational notes

- A TV should be on a stable internet connection and use fullscreen mode.
- Server-side signed links expire; if networking drops for more than 10
  minutes, reconnect or refresh after connectivity returns.
- Screenshots, camera recordings of the TV and photos taken by attendees are
  not controlled by the app, so explain this possibility in your event notice.
- Expiry of the guest QR URL and the wall's signed URLs does **not**
  automatically delete stored PNGs. Configure photo and registration retention,
  deletion, and access policies before a live event.
- CORS is not authentication. Keep the TV access key secret; monitor
  `kora-wall-feed` invocations and protect your Supabase endpoint with
  provider-level rate limits as appropriate.
