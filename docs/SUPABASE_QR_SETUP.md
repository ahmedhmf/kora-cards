# KORA — Supabase card uploads and QR downloads

The photo booth uploads **only the completed, composed card PNG** after ORMBG finishes.
It does **not** upload the original photo, the person's telephone number,
player details as separate records, or a database row. Player names and card
stats may of course be **visible inside the rendered PNG**.

## One-time Supabase setup

1. Create a Supabase project and open **Storage**.
2. Run `supabase/kora-cards-storage.sql` in the project's SQL Editor. This
   creates a **private** `kora-cards` bucket and restrictive storage policies.
3. In **Authentication > Users**, create or invite a dedicated KORA staff user.
   In SQL Editor, execute:
   ```sql
   insert into public.kora_storage_staff (user_id)
   values ('STAFF_USER_UUID_FROM_SUPABASE_AUTH');
   ```
4. In `src/environments/supabase-storage.config.ts`, set your Supabase URL
   and **publishable** (or legacy anon) key. Never place a service_role or secret
   key in browser code. Rebuild and redeploy.
5. KORA staff open the collapsible **KORA STAFF · SUPABASE STORAGE** settings
   in the card details screen and sign in with the dedicated staff account.
   The kiosk keeps the staff session in browser `sessionStorage` and can
   refresh its access token while the session persists.
6. A customer checks the **cloud storage consent** box, completes the player card
   and takes or uploads a photo. After the final card PNG is rendered, upload
   happens without a customer login. Print/Save are not blocked by the upload.
7. On success, KORA generates a **QR code locally** for a private signed
   download link valid for **seven days**. The customer's phone needs internet
   access to download. No QR-code provider receives the signed URL.

## Important behavior

- If no staff member is signed in, or no customer consent is given, **no upload**
  occurs and no QR is shown.
- If the network is unavailable, the customer can still save or print locally.
  Failed uploads are reported and **are not automatically queued/retried**.
- A QR/download URL grants temporary access to **that specific PNG**. Treat it
  like a private link. Signed links expire after seven days, but the stored PNG
  remains in the private bucket until deleted by an authorized administrator.
  Establish a retention and deletion policy before using this at public events.
- The printer and WhatsApp features stay separate. WhatsApp currently opens a
  text chat and does not attach the card image automatically.
- The SQL upload policy limits a staff user to their own UUID folder.
  Creating signed URLs requires a corresponding SELECT policy.
- Never open the staff account or Supabase dashboard for customers.

## Validation checklist

- `npm install && npm run build`
- Staff sign-in and refresh, incorrect password, lost internet, expired token
- Both camera and photo-upload card flows
- No QR before successful upload and explicit customer consent
- QR scanning with a second phone, image downloading and seven-day expiry
- Verify Supabase bucket is private and contains only `image/png`
- Reset/home clears customer data but preserves the staff kiosk session
- Rebuild and redeploy after editing `supabase-storage.config.ts`
