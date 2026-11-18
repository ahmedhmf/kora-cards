# KORA mobile template card — feature branch

This branch adds an **optional** template-based card renderer, leaving `src/app/core/card-renderer.service.ts` and the existing card artwork untouched. The classic renderer remains the default until the new artwork and dependency lockfile are installed and tested.

## What is implemented

- `TemplateCardRendererService`: single-PNG template composition at 877 × 1558 with a transparent person cutout and dynamic name, number, position, rating, and stats.
- `MobileBackgroundRemovalService`: browser-local ORMBG via Transformers.js (`wasm`, `uint8`) for still photographs.
- MediaPipe person segmentation for animated video and photo fallback.
- Player screen toggle: **NEW KORA TEMPLATE** / **CLASSIC CARDS**.
- Optional still-photo capture and a service-worker change that preserves non-KORA model caches.

## Required before enabling in production

1. **Upload the exact user-provided 877 × 1558 PNG** to `public/cards/kora-red-black-template.png`. It is included in the separately delivered ChatGPT ZIP package. GitHub's current text-focused file connector did not transfer the binary upload.
2. Run `npm install` and **commit the updated `package-lock.json`** alongside `package.json` to lock the new Transformers.js dependency.
3. Run `npm run build` and test on installed iOS and Android PWAs; the implementation has not passed an actual device or production build yet.
4. Validate cutout quality, hair/arm edges, portrait scale, rendered player text, video export, app memory consumption, model download size, cache retention, and offline fallback.
5. MediaPipe's model currently loads from an external URL; guaranteed first-run offline behavior requires bundling it.

**Rollback:** Choose CLASSIC CARDS. This branch does not delete or modify the existing renderer.

**Privacy:** AI inference is performed in the device's browser. ORMBG model weights are downloaded initially and cached when the browser permits; this is not an absolute guarantee of offline availability.

## Dynamic statistics overlay fix (mobile card)

Some uploaded designs include sample statistics already printed in the flat-red
panel. The template renderer now clears **only** the inner statistics area
(before drawing the dynamic `data.match.stats` values), both in the camera
preview and in the exported photo. The six statistics remain sourced from the
selected player's matching data; their values are **not** hard-coded.

Test on an Android and iOS phone: render two cards with different player
ratings and confirm PAC / SHO / PAS / DRI / DEF / PHY each appear only once
and show different values. Check that the red panel boundaries and football
artwork are unchanged. This is a frontend change; no Supabase migration needed.
