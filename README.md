# Kora Card PWA

Angular progressive web app that records a two-second goal celebration after a ten-second countdown and turns a still frame into a shareable Kora card.

The interface is inspired by the KORA product catalogue: editorial white space, technical black rails, pale-grey panel geometry, red accents, and the official KORA ball as the lead product visual.

The visual system uses a high-contrast KORA neumorphic treatment: raised selection and export controls, inset fields, recessed camera surfaces, tactile pressed states, and accessible black/red accents on a sculpted light-grey base.

The official wordmark lives at `public/brand/kora-logo.png` and is reused by the header, catalogue rail, generated photo-filter frame, player-card output, favicon, and install icon.

The opening studio now offers two reusable experiences: the original player-card creator and a photo-filter flow. The first filter previews the complete effect live in the camera, replaces the background with a wall of the catalogue football products, places frameless animated KORA ball lenses using face landmarks, captures exactly what the user sees, and supports native sharing or PNG download. Uploaded photos use the same processing pipeline.

Both experiences can export either a PNG image or a four-second canvas-recorded video. The player-card video preserves the celebration loop, while the photo-filter video preserves the rotating ball lenses. The exporter prefers MP4 where the browser supports it and otherwise uses WebM.

The result screen uses MediaPipe person segmentation to remove the camera background, loops the recorded celebration inside a blue-and-gold player card, and exports the current frame as a transparent PNG. The first background-removal run downloads the official MediaPipe selfie-segmentation model, so an internet connection is required once.

## Run locally

```bash
npm install
npm start
```

Camera access requires HTTPS or localhost. On iPhone, use Safari and add the site to the Home Screen for the most app-like experience.

## Architecture

- `app/card-shell.component.ts` is presentation-only and exposes the Signal Store to the template.
- `app/state/card.store.ts` owns UI state and workflow actions using `@ngrx/signals`.
- `app/core/camera.service.ts` owns camera access and video recording.
- `app/core/card-renderer.service.ts` owns MediaPipe segmentation and canvas composition.
- `app/core/card-export.service.ts` owns sharing and PNG downloads.
- `app/core/photo-filter.service.ts` owns reusable person segmentation, face-landmark tracking, product-wall composition, glasses placement, and KORA frame rendering.
- `public/brand/kora-ball-lens.gif` is the source animation for both glasses lenses. For reliable canvas and video export across mobile browsers, its 49 frames are prebuilt into `public/brand/kora-ball-lens-sprite.png`; the renderer advances the sprite frames while tracking the face position and angle.
- `app/core/inactivity.service.ts` monitors user activity and returns unfinished flows home after 30 seconds.
- `app/shared/media-stream.directive.ts` attaches a stream to a video element without camera logic in the component.
- `app/data/fc27-players.data.ts` contains the position-indexed FC 27 comparison pools and card attributes.

Selecting a position chooses a random player from that position's ten-player pool. The result displays “You remind us of …” and renders that player's overall and six attributes on the generated card. Ratings are a curated FC 27 launch snapshot and can be updated independently in the data file.

The persistent **Start over** control and the inactivity timeout both dispatch the same Signal Store reset action, which cancels pending countdown work and cleans up camera, renderer, and object-URL resources.

If an older service worker was previously installed, open browser DevTools → Application → Service Workers, unregister it, clear site data, and reload.

## Google Drive video uploads

The result screens can save generated player-card and photo-filter videos directly to a `KORA Event Uploads` folder in the usher's Google Drive. No application backend is required.

1. In Google Cloud Console, create or select a project and enable **Google Drive API**.
2. Configure the OAuth consent screen. While the app is in testing, add every usher's Google account as a test user.
3. Create an **OAuth 2.0 Client ID** with application type **Web application**.
4. Add `http://localhost:4200` and the production app origin to **Authorized JavaScript origins**.
5. Paste the client ID into `src/environments/google-drive.config.ts`.

The app requests only `https://www.googleapis.com/auth/drive.file`, so it can create and manage its own uploads without reading unrelated Drive content. Never add a client secret, service-account key or Google password to this PWA.
