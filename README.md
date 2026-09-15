# FixMyMix

On-stage messaging for performers. Runs on a laptop on the show Wi-Fi and works on any phone, tablet or laptop browser — **no internet connection needed while it's operating**.

The first mode is **Mix mode**: performers ask the engineer for more or less of anything in their monitor mix, the engineer sees it light up on the board, hits *Done*, and the performer's device confirms it.

## How it works

```
 Performer phones ──┐
 Performer tablets ─┼─── show Wi-Fi ───► laptop running FixMyMix ◄─── engineer's device (/admin)
 Performer laptops ─┘
```

- **Admin (`/admin`)** — passcode-locked. Sets the show name, the number of band members and the channels each one hears (Quick setup), then renames anything in the roster editor. The board groups pending requests by performer, shows how long each has been waiting, and turns red after 30 s. *Done* clears one, *All done* clears a performer, *Clear all* clears the board.
- **Stage (`/stage`)** — a performer picks their name once (remembered on the device) and gets one big row per channel with **−** and **+**. Tapping sends a request; the row turns amber with *Sent*. Tapping again pushes harder (×2, ×3…), tapping the other direction swaps it, and *cancel* withdraws it. When the engineer marks it done, the row turns green with **Done ✓** and the phone vibrates. The ⚙ settings on the stage page (saved per device) offer **Auto-dismiss confirmations** (on: the green row fades after 8 s; off: it stays until the performer taps it) and a **Layout** choice: *Rows* (one line per channel with − and +) or *Boxes* (a box per channel — tap the top half for more, the bottom half for less).
- The admin Setup tab also has **Add a channel to every member**, which appends one channel (e.g. *Click*) to everyone who doesn't already have it.
- **Messages** — off by default; the admin turns on **Allow messages** in Setup. Performers then get a text field at the bottom of the stage page to message the desk; each message shows on the board in their card with a *Done* button, and flips to **Seen ✓** on their device (following the auto-dismiss setting). The desk gets a composer at the bottom of the board to message one performer or everyone; those appear at the top of the performer's screen with a **Got it** button, and the board shows who has read them.
- **MIDI controllers** — both pages can *MIDI learn* five actions (⚙ on the stage page, Setup on the admin page), per device: a note, a CC (fires when it crosses 64, so a 0/127 foot switch fires once per press) or a program change.
  - Stage: *next* / *previous* move a highlight through the channels, *up* / *down* arm more or less on it, *confirm* sends — so a slip of the foot doesn't fire a request. With nothing armed, *confirm* answers a desk message or clears a green confirmation.
  - Admin: *next* / *previous* step through pending items, *up* / *down* jump between members, *confirm* marks the highlighted one done.
  - Browsers only expose Web MIDI on **secure pages** (https or `localhost`), and **Safari has none at all** — so no MIDI on iPhone/iPad. On the Mac running FixMyMix, open `http://localhost:8080` and it just works. For a stage laptop or Android device, turn on HTTPS: `npm run cert` (or the menu-bar item *Set up HTTPS*) creates a self-signed certificate and the server also listens on `https://<address>:8443`; each device accepts the certificate once (Advanced → Proceed). Chrome alternatively lets you mark the http address as secure at `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
- Members and channels can carry an **icon** (🎤 🎸 🎻 🥁 🎹 🎵 🎶 🎺 🎷 🪘 🎙 🎧 🔊 🎛 ✨), shown on the stage page and the board. Icons are guessed from the name as you type (*Kick* → 🥁) and can be picked explicitly in the roster editor. They're emoji, so nothing is downloaded.
- Everything is pushed live over Server-Sent Events with a polling fallback, so a phone that wakes from sleep catches up straight away.

## Running it

Two ways to run the same server. Neither needs internet once it's going.

### Menu-bar app (Mac)

A tray icon that runs the server and shows the address and passcode:

```
FixMyMix is running
Performers open (click to copy):
  http://192.168.1.23:8080
Admin passcode: 1234
Open admin board
Open stage view
Show QR code for performers
Show QR code for AbleSet
Stop server
Start at login
Quit FixMyMix
```

Build it once on the Mac you'll use at shows:

```sh
git clone https://github.com/jonpikereally/FixMyMix.git
cd FixMyMix
npm install
npm run app:package
```

That produces `desktop/dist/FixMyMix-darwin-<arch>/FixMyMix.app`; drag it to Applications. If the project folder is synced by Dropbox or iCloud, build somewhere local instead — a synced folder turns files inside the app into online-only placeholders and Finder then refuses to copy it: `FIXMYMIX_APP_OUT=~/Desktop npm run app:package`. It's a menu-bar-only app (no Dock icon) that bundles its own copy of Node, so the show Mac needs nothing else installed. It stores its state under `~/Library/Application Support/FixMyMix/`. `npm run app` runs it unpackaged for development.

The app isn't code-signed, so the first launch needs a right-click → Open (or System Settings → Privacy & Security → Open Anyway).

### Installing on another Mac

Every tagged version has a ready-made installer on the [Releases page](https://github.com/jonpikereally/FixMyMix/releases): download `FixMyMix-<version>.dmg`, open it, drag FixMyMix to Applications. The other Mac needs nothing else — no Node, no git.

First launch on a new Mac: the app isn't notarised, so macOS will object once. **Right-click FixMyMix → Open**; on macOS 15 or later you may instead need **System Settings → Privacy & Security → Open Anyway** after the first attempt. (Or, in Terminal: `xattr -dr com.apple.quarantine /Applications/FixMyMix.app`.) It also asks whether FixMyMix may accept incoming connections — **Allow**.

To make an installer yourself on a Mac that has the source: `npm run app:dmg` builds a universal (Intel + Apple Silicon) app and writes `~/Desktop/FixMyMix-build/FixMyMix-<version>.dmg`. Tagging a commit `vX.Y.Z` and pushing the tag makes GitHub build and publish it (`.github/workflows/release.yml`).

### From the terminal

Requires Node.js 20 or newer. The server itself has no npm dependencies.

```sh
git clone https://github.com/jonpikereally/FixMyMix.git
cd FixMyMix
npm start
```

The terminal prints the LAN address(es) and the admin passcode:

```
  Performers open one of these on the same Wi-Fi:
    http://192.168.1.23:8080

  Admin passcode: 1234
```

1. Put the laptop and every device on the same Wi-Fi (a phone hotspot or a travel router works fine; the router doesn't need an uplink).
2. Open `/admin` on the engineer's device, enter the passcode, run **Quick setup**, rename members and channels.
3. Performers open the LAN address, tap **I'm on stage**, pick their name. Adding the page to the home screen gives a full-screen view. Easiest: open **`/join`** (the *QR* button on the board, or *Show QR code for performers* in the menu bar) and let them scan the code — it's generated by the app itself, no internet involved. The same page makes a code for **AbleSet** (this computer's address, plus a port only if AbleSet shows one) or for **any address** on the network — a mixer's remote page, a lyrics screen.

The admin board is just a web page too, so it can run on an iPad (or a phone, or a second laptop) on the same Wi-Fi: open `http://<address>:8080/admin`, enter the passcode, and use Share → *Add to Home Screen* for a full-screen board. Any number of admin devices can be open at once. The server itself still runs on the Mac — an iPad can't host it.

### Options

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on; if it's taken (AbleSet also likes 8080) the next free one up to +9 is used, and every address shown carries the real port |
| `HOST` | `0.0.0.0` | Interface to bind |
| `ADMIN_PASSCODE` | — | Forces the admin passcode at startup (4–12 digits); otherwise the last one set in Setup is used, `1234` to begin with |
| `HTTPS_PORT` | `8443` | Port for https, used only when `data/key.pem` and `data/cert.pem` exist (`npm run cert`) |
| `FIXMYMIX_DATA_DIR` | `./data` | Where `state.json` (roster, requests, messages), `config.json` (passcode, session secret) and the optional certificate live |

State is saved to disk after every change, so restarting the server mid-show keeps the roster, the board and admin logins. The passcode starts as `1234` — the lock is there to stop a performer wandering into the board by accident on a private stage Wi-Fi, not to resist an attacker. Change it in **Setup → Admin passcode**; it's saved with the show, other admin devices are logged out, and the menu bar shows the new one. These variables apply to both the terminal and the menu-bar app (the app ignores `FIXMYMIX_DATA_DIR` and uses the Application Support folder).

## Gig checklist

What actually goes wrong at shows, and what the app and you do about it.

**The app's side**

- The menu-bar app keeps the Mac awake while the server runs (*Keep Mac awake while running*, on by default). The lid still has to stay open.
- Stage pages keep the phone's screen on (⚙ → *Keep the screen on*, default on), so nobody misses a green confirmation because their phone locked.
- A tap survives a Wi-Fi blip: it retries quietly for ~15 s with a *Sending…* note, and the server applies each tap exactly once, so a retry never turns "more" into "more ×2".
- The board shows a green dot on every connected performer and "N devices connected"; the menu bar shows the device count too.
- **Buzz everyone** (and a per-performer *Buzz*) makes phones vibrate and flash — the soundcheck "is everyone on?" test, and a way to get someone's attention mid-set.
- If the server inside the app ever stops answering, the app restarts it within ~20 s and writes what happened to the log (*Open log* in the menu). The tray icon dims while the server is stopped.

**Your side**

1. **Bring your own Wi-Fi.** Venue networks fail in two ways: captive portals, and *client isolation* that silently stops phones talking to the laptop. A travel router dedicated to the band (no internet needed) with a fixed name and password means every phone auto-joins. Give the laptop a DHCP reservation in the router so its address — and the QR code — never changes. Make sure client/AP isolation is **off**.
2. **First launch:** macOS asks whether FixMyMix may accept incoming connections. Click **Allow**, or nothing can reach it.
3. **Laptop:** plugged in, lid open (the screen can dim), *Start at login* on so a reboot recovers by itself.
4. **Phones:** *Add to Home Screen* once for a full-screen view.
5. **Soundcheck ritual:** open the board, check every dot is green, press *Buzz everyone*, watch the phones light up.

## Development

```sh
npm run dev    # restarts on file changes
npm test       # state-machine tests (node --test)
```

Layout:

```
src/state.js      Show state and the request rules (pure)
src/api.js        The API routes and SSE hub, independent of transport
src/auth.js       Passcode check: Web Crypto HMAC, constant-time compare
src/server.js     Node HTTP(S) adapter, static files, persistence, security headers
src/tls.js        Optional self-signed certificate (needed for Web MIDI off-host)
public/           Static app: landing, stage, admin and join pages, no build step
                  (js/midi.js: Web MIDI learn; js/qr.js: QR encoder for the join page)
desktop/          Menu-bar app (Electron): tray menu, icons, packaging plist
test/             node:test suites for state, api/auth and the tray menu
```

`npm run icons` regenerates the tray and app icons from `desktop/scripts/icons.mjs` (a dependency-free PNG/ICNS writer), so there are no binary assets to maintain by hand.

## Security notes

- Admin routes require a passcode (default `1234`, changeable in Setup); the check is a timing-safe compare, login attempts are rate-limited per IP, and changing the passcode rotates the session secret so existing admin cookies stop working.
- Every response carries `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`. The CSP allows no inline script or style. `Strict-Transport-Security` is deliberately omitted because the app is served over plain HTTP on a private LAN, where browsers ignore it.
- Performer actions are unauthenticated by design (a stage is a trusted room) but are validated against the roster and throttled per performer.

## Roadmap

Mix mode is the first mode. The server and state layer are built so further modes (set-list cues, talkback text, "I need a tech" alerts) can sit alongside it on the same connection.
