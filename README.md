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
- **Stage (`/stage`)** — a performer picks their name once (remembered on the device) and gets one big row per channel with **−** and **+**. Tapping sends a request; the row turns amber with *Sent*. Tapping again pushes harder (×2, ×3…), tapping the other direction swaps it, and *cancel* withdraws it. When the engineer marks it done, the row turns green with **Done ✓** and the phone vibrates.
- Everything is pushed live over Server-Sent Events with a polling fallback, so a phone that wakes from sleep catches up straight away.

## Running it

Requires Node.js 20 or newer. No npm dependencies — nothing to install, nothing to fetch at showtime.

```sh
git clone https://github.com/jonpikereally/FixMyMix.git
cd FixMyMix
npm start
```

The terminal prints the LAN address(es) and the admin passcode:

```
  Performers open one of these on the same Wi-Fi:
    http://192.168.1.23:8080

  Admin passcode: 482913
```

1. Put the laptop and every device on the same Wi-Fi (a phone hotspot or a travel router works fine; the router doesn't need an uplink).
2. Open `/admin` on the engineer's device, enter the passcode, run **Quick setup**, rename members and channels.
3. Performers open the LAN address, tap **I'm on stage**, pick their name. Adding the page to the home screen gives a full-screen view.

### Options

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `ADMIN_PASSCODE` | random 6 digits, persisted | Admin passcode; set it to keep the same one across restarts |
| `FIXMYMIX_DATA_DIR` | `./data` | Where `state.json` (roster, requests) and `config.json` (passcode, session secret) live |

State is saved to disk after every change, so restarting the server mid-show keeps the roster, the board and admin logins.

## Development

```sh
npm run dev    # restarts on file changes
npm test       # state-machine tests (node --test)
```

Layout:

```
src/server.js     HTTP + SSE server, admin auth, persistence, security headers
src/state.js      Show state and the request rules (pure, tested)
public/           Static app: landing, stage and admin pages, no build step
test/             node:test suite for src/state.js
```

## Security notes

- Admin routes require a passcode; the check is a timing-safe compare and login attempts are rate-limited per IP.
- Every response carries `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`. The CSP allows no inline script or style. `Strict-Transport-Security` is deliberately omitted because the app is served over plain HTTP on a private LAN, where browsers ignore it.
- Performer actions are unauthenticated by design (a stage is a trusted room) but are validated against the roster and throttled per performer.

## Roadmap

Mix mode is the first mode. The server and state layer are built so further modes (set-list cues, talkback text, "I need a tech" alerts) can sit alongside it on the same connection.
