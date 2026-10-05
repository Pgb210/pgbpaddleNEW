# PGB Padel Booking PWA

The site retains its existing login, booking flows, API, and database. Its manifest launches the home page in standalone mode and supplies standard, maskable, and Apple home-screen icons. Mobile layouts account for device safe areas and keep text inputs readable without automatic iOS zoom.

## Installation

Open the HTTPS preview on a supported browser before publishing. Chromium browsers show an Install app button when installation is available; their browser menu can also offer installation. On iPhone and iPad, Add to Home Screen opens instructions for Safari’s Share menu. Launch the installed icon to check the standalone experience. Installation controls are hidden inside the standalone app.

## Offline and updates

Booking data, credentials, the main HTML page, API calls, and third-party requests are never stored in the service worker cache. Booking requests retain their original network behavior. An offline launch shows a dedicated connection notice rather than stale availability or an offline booking form. The offline notice becomes available after the first successful online visit and service worker installation. Offline bookings are not queued or replayed.

Only the offline page and explicit PWA assets are precached. New service workers wait for existing app windows to close before activating, avoiding forced reloads during booking. Increment the cache version in `sw.js` whenever changing precached assets so the next worker installs a fresh offline cache. Old caches belonging to this PWA are removed on activation; other site caches are left alone.

## Preview checklist

- Open the HTTPS preview and confirm the login and booking screens still behave as before.
- Inspect the browser’s Application panel: manifest name, standalone display, icons, and active service worker.
- Install on Android/desktop Chromium and on iOS Safari; launch from the home screen and confirm the browser address bar is absent.
- After one online visit, enable offline mode and reload: only the connection notice appears. Restore connectivity and select Try again.
- Confirm booking API calls go directly to the network and no booking responses appear in Cache Storage.
- Close all preview app windows and reopen after an update to confirm the new worker activates without interrupting a booking session.

The preview origin has its own installation and service worker, separate from the production site. Preview testing does not require publishing production changes.
