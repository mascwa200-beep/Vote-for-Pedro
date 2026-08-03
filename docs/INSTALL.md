# Getting it onto the phone

Written for a Pixel 10 Pro XL on GrapheneOS, but nothing here is
GrapheneOS-specific — any modern Android browser works the same way.

Once installed, the game never touches the network again. You can put the
phone in airplane mode and it will keep working, permanently.

---

## Option 1 — Install the APK (recommended on Android)

`dist/starfleet-command.apk` is a real Android package. It is a WebView shell
around the game, and it declares **exactly one permission: `VIBRATE`**. There
is no `INTERNET` permission, so the app physically cannot reach the network —
not "does not", *cannot*.

1. Copy `starfleet-command.apk` to the phone.
2. Open **Files**, tap it, and allow installation from that source when asked.
   GrapheneOS will prompt once per installing app; that is expected.
3. It appears in your app drawer as **Starfleet Command**.

The APK is signed with a project debug key, not a Play Store key, so Android
will describe it as coming from an unknown developer. That is accurate.

`minSdk 26 (Android 8) · targetSdk 35 · ~164 KB`

To rebuild it yourself you need an Android SDK with build-tools and a
platform installed — no Gradle, no Maven, no network at build time:

```sh
ANDROID_HOME=/path/to/android-sdk ./tools/build-apk.sh
```

The back button steps through the game's own screens before it leaves the app,
and backgrounding it triggers an autosave.

---

## Option 2 — Install as a web app (PWA)

This gives you a home-screen icon that opens fullscreen with no browser
chrome, and works with the radio off.

1. Open the game's URL in **Vanadium** (or Chrome/Firefox — any of them work).
2. Wait about two seconds. The service worker caches the whole game — it is
   only code, so this is essentially instant.
3. Tap the **⋮** menu → **Add to Home screen** (Vanadium and Chrome) or
   **Install**. Firefox calls it **Install**.
4. Confirm. The icon appears in your app drawer.

From then on, launch it from the drawer like any other app. It never
requests the network again.

**To verify it is genuinely offline:** turn on airplane mode and launch it.
It should open normally and be fully playable. If it does, you are done.

### Serving it yourself

If you would rather host it than use a link:

```sh
git clone <this repo>
cd Vote-for-Pedro
npm start            # serves at http://localhost:8099
```

Then open that address from the phone on the same network. Note that
**Add to Home screen installs a PWA properly only over HTTPS or on
localhost** — over plain HTTP on a LAN address, the browser will still let
you add a shortcut, but the service worker may not register, so offline
support will not be reliable. For a permanent LAN install, put it behind
any HTTPS front end, or use Option 2 below.

### GitHub Pages

The repository is a static site with no build step, so Pages serves it
as-is: repository **Settings → Pages → Deploy from a branch**, pick the
branch and the `/` root folder. The resulting HTTPS URL installs cleanly.

---

## Option 3 — One file, no server, no install

`dist/starfleet-command.html` is the entire game — code, styles, and icon —
in a single self-contained HTML file. No network requests of any kind.

1. Download that one file to the phone's **Downloads** folder.
2. Open **Files**, tap it, and choose your browser.
3. It runs.

This route needs no server and no HTTPS. The trade-off is that there is no
home-screen icon and no service worker; you reopen it from Files each time.
Saves still persist (they use `localStorage`, keyed to the file's origin) —
though a browser that clears site data on exit will clear them too, so use
**Setup → Export to file** if you want a durable record.

To rebuild it after changing the source:

```sh
npm run build        # writes dist/starfleet-command.html
```

---

## Saves

- The game **autosaves every 30 seconds**, and whenever you background it.
- Saves live in `localStorage` under `sfc:save:auto`.
- **Setup → Export to file** writes the whole command record out as JSON —
  seed, ledger, crew, ship, everything. **Import from file** restores it,
  including on a different device.
- Uninstalling the PWA or clearing site data deletes the save. Export first
  if you care about it.

---

## Permissions

The game asks for nothing. There are no accounts, no telemetry, no
analytics, and no network calls at all. Three optional device features are
used if the browser offers them, and the game works fine without any of
them:

| Feature | Used for | If unavailable |
|---|---|---|
| Vibration API | Haptics on impacts and alerts | Silently skipped |
| Screen Wake Lock | Keeps the screen on during red alert | Screen dims as usual |
| SpeechSynthesis | Officers acknowledging orders aloud | Text only |

All three can be turned off in **Setup**.

---

## Troubleshooting

**No sound.** Mobile browsers require a user gesture before any audio can
start. Tap anything once. Also check the phone is not on silent — the game
routes through the media channel.

**Sound is quiet or thin.** Every sound is generated live rather than played
from a file, so it goes through the phone's speaker with no mastering. Raise
**Setup → Master**, or use headphones.

**No officer voice.** `SpeechSynthesis` depends on a TTS engine being
installed and having a voice downloaded. GrapheneOS ships without Google
TTS. Install any TTS engine, or leave it off — it is flavour only.

**It asked to go online / did not work in airplane mode.** The service
worker did not register. That happens over plain HTTP on a non-localhost
address. Use HTTPS, or use Option 2.

**Text is too small.** **Setup → Text size** has Large and Extra Large.

**Everything is one long scroll in landscape.** Rotate to portrait — that is
the primary layout. Landscape widens the tactical view and puts the controls
beside it, which needs a short viewport to trigger.
