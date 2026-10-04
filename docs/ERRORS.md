# FixMyMix error codes

<!-- Generated from public/js/errors.js by `npm run errors:doc`. Do not edit by hand. -->

Every error FixMyMix shows ends with a code, for example **(Error FMM-P06)**. Find the code below to see what happened and what to do.

- **Asking an AI assistant?** Paste the whole error message including the code, and this link: https://github.com/jonpikereally/FixMyMix/blob/main/docs/ERRORS.md (plain text: https://raw.githubusercontent.com/jonpikereally/FixMyMix/main/docs/ERRORS.md).
- **On the show Wi-Fi with no internet?** The same list is built into FixMyMix: open `/errors` on the FixMyMix address, e.g. `http://192.168.1.20:8080/errors`. Every error popup also has a Help link to it.
- **For developers:** API error bodies carry `error` (the message), `code` (the slug), `errorCode` (the FMM- code), `help` and `helpUrl`.

_For AI assistants: FixMyMix is a local app for live bands. Performers tap + / − on their phones to ask the sound engineer for more or less of a channel in their monitor mix; the engineer clears requests on an admin board. It runs on one Mac (a menu-bar app) on the venue Wi-Fi and needs no internet during the show. The admin passcode is shown in the FixMyMix menu-bar menu._

## All codes

| Code | Message |
| --- | --- |
| [FMM-C01](#fmm-c01) | No connection to the mix desk. |
| [FMM-C02](#fmm-c02) | Lost connection to the server. Reconnecting… |
| [FMM-C03](#fmm-c03) | Cannot reach the FixMyMix server. Are you on the show Wi-Fi? |
| [FMM-R01](#fmm-r01) | The request could not be read. |
| [FMM-R02](#fmm-r02) | Request body too large. |
| [FMM-R03](#fmm-r03) | No such endpoint. |
| [FMM-R04](#fmm-r04) | Page not found. |
| [FMM-R05](#fmm-r05) | Method not allowed. |
| [FMM-R06](#fmm-r06) | Nothing to resolve. |
| [FMM-P01](#fmm-p01) | That performer is no longer in the roster. |
| [FMM-P02](#fmm-p02) | That channel is no longer in your mix. |
| [FMM-P03](#fmm-p03) | Request must be "more" or "less". |
| [FMM-P04](#fmm-p04) | That request has already been handled. |
| [FMM-P05](#fmm-p05) | Slow down — the request is already on the board. |
| [FMM-P06](#fmm-p06) | Messages are switched off for this show. |
| [FMM-P07](#fmm-p07) | Type a message first. |
| [FMM-P08](#fmm-p08) | Slow down — give the desk a moment. |
| [FMM-P09](#fmm-p09) | That message has already been handled. |
| [FMM-A01](#fmm-a01) | Admin passcode required. |
| [FMM-A02](#fmm-a02) | Wrong passcode. |
| [FMM-A03](#fmm-a03) | Too many attempts. Wait a minute. |
| [FMM-A04](#fmm-a04) | Passcode must be 4 to 12 digits. |
| [FMM-A05](#fmm-a05) | Keep at least one performer in the roster. |
| [FMM-A06](#fmm-a06) | Members must be 1–24. |
| [FMM-A07](#fmm-a07) | Channels must be 1–16. |
| [FMM-A08](#fmm-a08) | Every member needs at least one channel. |
| [FMM-A09](#fmm-a09) | Max 24 members. |
| [FMM-A10](#fmm-a10) | Max 16 channels per member. |
| [FMM-A11](#fmm-a11) | Type a channel name first. |
| [FMM-A12](#fmm-a12) | Everyone already has that channel. |
| [FMM-S01](#fmm-s01) | That is not a FixMyMix setup file. |
| [FMM-S02](#fmm-s02) | That file has no band members in it. |
| [FMM-S03](#fmm-s03) | That setup is no longer saved. |
| [FMM-S04](#fmm-s04) | You can keep up to 50 setups. Delete one first. |
| [FMM-S05](#fmm-s05) | Give the setup a name first. |
| [FMM-S06](#fmm-s06) | That file is not valid JSON. |
| [FMM-H01](#fmm-h01) | Could not load the show log. |
| [FMM-J01](#fmm-j01) | No network address yet — is the computer on Wi-Fi? |
| [FMM-J02](#fmm-j02) | Type the address of the computer running Ableton. |
| [FMM-J03](#fmm-j03) | Port must be between 1 and 65535, or empty. |
| [FMM-J04](#fmm-j04) | Type an address to encode. |
| [FMM-J05](#fmm-j05) | That does not look like a web address. |
| [FMM-J06](#fmm-j06) | That address is too long for a QR code. |
| [FMM-B01](#fmm-b01) | This browser has no Web MIDI. Safari (and every browser on iPhone/iPad) cannot do MIDI; use Chrome, Edge or Firefox on a laptop or Android. |
| [FMM-B02](#fmm-b02) | Browsers only allow MIDI on a secure page. On the computer running FixMyMix open http://localhost; on another laptop use the https:// address shown in the FixMyMix menu (accept the certificate once). |
| [FMM-B03](#fmm-b03) | MIDI permission refused. |
| [FMM-B04](#fmm-b04) | Not available in this browser — turn off Auto-Lock in the phone's settings for the show instead. |
| [FMM-B06](#fmm-b06) | This browser would not copy the text. |
| [FMM-B05](#fmm-b05) | This browser cannot play the alert sound. |
| [FMM-D01](#fmm-d01) | The port is already in use. |
| [FMM-D02](#fmm-d02) | The FixMyMix server could not start. |
| [FMM-D03](#fmm-d03) | No https: the certificate could not be created. |
| [FMM-D04](#fmm-d04) | A data file could not be read and was ignored. |
| [FMM-D05](#fmm-d05) | Could not save to the data folder. |
| [FMM-U01](#fmm-u01) | Could not check for updates. |
| [FMM-U02](#fmm-u02) | The update download failed. |
| [FMM-U03](#fmm-u03) | Could not unpack the update. |
| [FMM-U04](#fmm-u04) | The update did not contain an app. |
| [FMM-U05](#fmm-u05) | The downloaded update is a different version than expected. |
| [FMM-U06](#fmm-u06) | FixMyMix is running from the source folder, not an installed app. |
| [FMM-U07](#fmm-u07) | FixMyMix is running from the disk image. Drag it to Applications first. |
| [FMM-U08](#fmm-u08) | macOS is running a temporary copy. Move FixMyMix to Applications and open it from there. |
| [FMM-U09](#fmm-u09) | The download helper stopped unexpectedly. |
| [FMM-X01](#fmm-x01) | Something went wrong on the server. |
| [FMM-X02](#fmm-x02) | Something went wrong on this page. |
| [FMM-X99](#fmm-x99) | Something went wrong. |

## Connection

### FMM-C01

- **Message:** No connection to the mix desk.
- **What it means and what to do:** The phone has lost the FixMyMix server. Check it is on the show Wi-Fi and that the FixMyMix laptop is awake and running. The page reconnects by itself.
- **Slug:** `offline_stage`

### FMM-C02

- **Message:** Lost connection to the server. Reconnecting…
- **What it means and what to do:** The board has lost the FixMyMix server. Check the Wi-Fi and that FixMyMix is running on the laptop (menu bar icon). It reconnects by itself.
- **Slug:** `offline_admin`

### FMM-C03

- **Message:** Cannot reach the FixMyMix server. Are you on the show Wi-Fi?
- **What it means and what to do:** A tap or button press could not reach the server after several tries. Join the show Wi-Fi, make sure FixMyMix is running, then try again.
- **Slug:** `unreachable`

## Request

### FMM-R01

- **Message:** The request could not be read.
- **What it means and what to do:** The page sent something the server could not parse. Reload the page; if it keeps happening, update FixMyMix.
- **Slug:** `bad_json`

### FMM-R02

- **Message:** Request body too large.
- **What it means and what to do:** The request was bigger than 256 KB. Usually an oversized setup file being imported.
- **Slug:** `too_large`

### FMM-R03

- **Message:** No such endpoint.
- **What it means and what to do:** The page asked for an API the server does not have. The page and the app are probably different versions: reload the page.
- **Slug:** `not_found`

### FMM-R04

- **Message:** Page not found.
- **What it means and what to do:** There is no page at that address. Use /stage for performers, /admin for the board, /join for the QR code.
- **Slug:** `page_not_found`

### FMM-R05

- **Message:** Method not allowed.
- **What it means and what to do:** Something tried to change a static page. Reload; nothing is wrong with the show.
- **Slug:** `method_not_allowed`

### FMM-R06

- **Message:** Nothing to resolve.
- **What it means and what to do:** Done was pressed without saying what was done. Reload the board.
- **Slug:** `nothing_to_resolve`

## Performer

### FMM-P01

- **Message:** That performer is no longer in the roster.
- **What it means and what to do:** The desk changed the roster. Tap "Not me" and pick your name again.
- **Slug:** `unknown_member`

### FMM-P02

- **Message:** That channel is no longer in your mix.
- **What it means and what to do:** The desk removed or replaced that channel. The page refreshes the list; tap again on the channel you want.
- **Slug:** `unknown_channel`

### FMM-P03

- **Message:** Request must be "more" or "less".
- **What it means and what to do:** The page sent an unknown request type. Reload the page.
- **Slug:** `bad_direction`

### FMM-P04

- **Message:** That request has already been handled.
- **What it means and what to do:** Someone already cleared or cancelled it. Nothing to do.
- **Slug:** `unknown_request`

### FMM-P05

- **Message:** Slow down — the request is already on the board.
- **What it means and what to do:** Too many taps in a few seconds from one performer. The request is on the board; wait a moment.
- **Slug:** `request_throttled`

### FMM-P06

- **Message:** Messages are switched off for this show.
- **What it means and what to do:** The desk has not turned on Allow messages. Admin: Setup → Allow messages.
- **Slug:** `messaging_off`

### FMM-P07

- **Message:** Type a message first.
- **What it means and what to do:** The message box was empty.
- **Slug:** `empty_message`

### FMM-P08

- **Message:** Slow down — give the desk a moment.
- **What it means and what to do:** More than six messages in ten seconds. Wait a few seconds and send again.
- **Slug:** `message_throttled`

### FMM-P09

- **Message:** That message has already been handled.
- **What it means and what to do:** It was already marked done or read. Nothing to do.
- **Slug:** `unknown_message`

## Admin

### FMM-A01

- **Message:** Admin passcode required.
- **What it means and what to do:** This device is not logged in to the board, or the passcode was changed elsewhere. Enter the admin passcode (shown in the FixMyMix menu).
- **Slug:** `unauthorized`

### FMM-A02

- **Message:** Wrong passcode.
- **What it means and what to do:** The admin passcode did not match. The engineer can see it in the FixMyMix menu-bar menu on the laptop running FixMyMix.
- **Slug:** `wrong_passcode`

### FMM-A03

- **Message:** Too many attempts. Wait a minute.
- **What it means and what to do:** Eight wrong passcodes in a minute from one device. Wait a minute, then use the passcode from the FixMyMix menu.
- **Slug:** `login_throttled`

### FMM-A04

- **Message:** Passcode must be 4 to 12 digits.
- **What it means and what to do:** A new admin passcode must be digits only, 4 to 12 of them.
- **Slug:** `bad_new_passcode`

### FMM-A05

- **Message:** Keep at least one performer in the roster.
- **What it means and what to do:** The roster cannot be empty. Add a member before removing the last one.
- **Slug:** `empty_roster`

### FMM-A06

- **Message:** Members must be 1–24.
- **What it means and what to do:** Quick setup takes between 1 and 24 band members.
- **Slug:** `bad_member_count`

### FMM-A07

- **Message:** Channels must be 1–16.
- **What it means and what to do:** Quick setup takes between 1 and 16 channels per member.
- **Slug:** `bad_channel_count`

### FMM-A08

- **Message:** Every member needs at least one channel.
- **What it means and what to do:** A member in the roster editor has no channels. Add one (or remove the member) before saving.
- **Slug:** `member_needs_channel`

### FMM-A09

- **Message:** Max 24 members.
- **What it means and what to do:** A roster holds up to 24 members.
- **Slug:** `too_many_members`

### FMM-A10

- **Message:** Max 16 channels per member.
- **What it means and what to do:** Each member can have up to 16 channels.
- **Slug:** `too_many_channels`

### FMM-A11

- **Message:** Type a channel name first.
- **What it means and what to do:** Add to everyone needs a channel name.
- **Slug:** `channel_name_missing`

### FMM-A12

- **Message:** Everyone already has that channel.
- **What it means and what to do:** No member was changed: they all have a channel with that name, or are at the 16-channel limit.
- **Slug:** `channel_exists_everyone`

## Band setups

### FMM-S01

- **Message:** That is not a FixMyMix setup file.
- **What it means and what to do:** The imported JSON is not a setup. Use a file made with Export in Setup → Band setups.
- **Slug:** `bad_setup`

### FMM-S02

- **Message:** That file has no band members in it.
- **What it means and what to do:** The setup file is valid JSON but its members list is empty or unreadable.
- **Slug:** `setup_no_members`

### FMM-S03

- **Message:** That setup is no longer saved.
- **What it means and what to do:** It was deleted, perhaps from another device. Reopen the Setup tab to refresh the list.
- **Slug:** `unknown_setup`

### FMM-S04

- **Message:** You can keep up to 50 setups. Delete one first.
- **What it means and what to do:** The saved-setups list is full. Export any you want to keep, then delete some.
- **Slug:** `too_many_setups`

### FMM-S05

- **Message:** Give the setup a name first.
- **What it means and what to do:** Type a name in the box before pressing Save current.
- **Slug:** `setup_name_missing`

### FMM-S06

- **Message:** That file is not valid JSON.
- **What it means and what to do:** The file chosen for import could not be read as JSON. Pick a .json file exported from FixMyMix.
- **Slug:** `setup_not_json`

## Show log

### FMM-H01

- **Message:** Could not load the show log.
- **What it means and what to do:** The History tab or report could not fetch the log. Check the connection and reload.
- **Slug:** `history_load_failed`

## QR codes

### FMM-J01

- **Message:** No network address yet — is the computer on Wi-Fi?
- **What it means and what to do:** The laptop has no Wi-Fi or network address, so there is nothing to put in the QR code. Join the show network.
- **Slug:** `no_address`

### FMM-J02

- **Message:** Type the address of the computer running Ableton.
- **What it means and what to do:** The AbleSet QR needs the address of the AbleSet computer.
- **Slug:** `ableset_host_missing`

### FMM-J03

- **Message:** Port must be between 1 and 65535, or empty.
- **What it means and what to do:** Leave the port empty for AbleSet unless it uses a non-standard one.
- **Slug:** `bad_port`

### FMM-J04

- **Message:** Type an address to encode.
- **What it means and what to do:** The Any address tab needs a web address.
- **Slug:** `custom_url_missing`

### FMM-J05

- **Message:** That does not look like a web address.
- **What it means and what to do:** Start it with http:// or https://.
- **Slug:** `bad_url`

### FMM-J06

- **Message:** That address is too long for a QR code.
- **What it means and what to do:** Use a shorter address.
- **Slug:** `qr_too_long`

## Browser

### FMM-B01

- **Message:** This browser has no Web MIDI. Safari (and every browser on iPhone/iPad) cannot do MIDI; use Chrome, Edge or Firefox on a laptop or Android.
- **What it means and what to do:** Web MIDI is missing from Safari and all iOS browsers.
- **Slug:** `midi_unsupported`

### FMM-B02

- **Message:** Browsers only allow MIDI on a secure page. On the computer running FixMyMix open http://localhost; on another laptop use the https:// address shown in the FixMyMix menu (accept the certificate once).
- **What it means and what to do:** MIDI needs a secure context: localhost, or the https address.
- **Slug:** `midi_insecure`

### FMM-B03

- **Message:** MIDI permission refused.
- **What it means and what to do:** The browser blocked MIDI. Allow it in the site settings (the icon left of the address bar) and press Enable MIDI again.
- **Slug:** `midi_denied`

### FMM-B04

- **Message:** Not available in this browser — turn off Auto-Lock in the phone's settings for the show instead.
- **What it means and what to do:** This browser cannot keep the screen awake. On iPhone: Settings → Display & Brightness → Auto-Lock → Never.
- **Slug:** `wake_lock_unsupported`

### FMM-B06

- **Message:** This browser would not copy the text.
- **What it means and what to do:** Select the text shown under the code and copy it by hand (long-press on a phone).
- **Slug:** `copy_failed`

### FMM-B05

- **Message:** This browser cannot play the alert sound.
- **What it means and what to do:** Web Audio is missing or blocked. The flash and red row still carry the alert.
- **Slug:** `audio_unavailable`

## Mac app

### FMM-D01

- **Message:** The port is already in use.
- **What it means and what to do:** Another program holds every port FixMyMix tries (80, 8080–8085, …). Quit the other program, or start FixMyMix with PORT set to a free port.
- **Slug:** `port_in_use`

### FMM-D02

- **Message:** The FixMyMix server could not start.
- **What it means and what to do:** See the log (FixMyMix menu → Open log) for the reason, then choose Try again.
- **Slug:** `server_start_failed`

### FMM-D03

- **Message:** No https: the certificate could not be created.
- **What it means and what to do:** openssl failed. http still works for phones; MIDI on other laptops needs https. Check the log.
- **Slug:** `no_https`

### FMM-D04

- **Message:** A data file could not be read and was ignored.
- **What it means and what to do:** state.json, setups.json, history.json or config.json in the data folder is damaged. FixMyMix started without it.
- **Slug:** `data_file_unreadable`

### FMM-D05

- **Message:** Could not save to the data folder.
- **What it means and what to do:** The disk may be full or the folder read-only. Check free space.
- **Slug:** `save_failed`

## Updates

### FMM-U01

- **Message:** Could not check for updates.
- **What it means and what to do:** GitHub could not be reached. The laptop needs internet to update; the show itself does not.
- **Slug:** `update_check_failed`

### FMM-U02

- **Message:** The update download failed.
- **What it means and what to do:** The download was interrupted. Try again on a better connection.
- **Slug:** `update_download_failed`

### FMM-U03

- **Message:** Could not unpack the update.
- **What it means and what to do:** The downloaded zip was damaged. Try again; or install from the DMG on the releases page.
- **Slug:** `update_unpack_failed`

### FMM-U04

- **Message:** The update did not contain an app.
- **What it means and what to do:** The release zip is broken. Install from the DMG on the releases page.
- **Slug:** `update_no_app`

### FMM-U05

- **Message:** The downloaded update is a different version than expected.
- **What it means and what to do:** The release was replaced while downloading. Check for updates again.
- **Slug:** `update_version_mismatch`

### FMM-U06

- **Message:** FixMyMix is running from the source folder, not an installed app.
- **What it means and what to do:** In-app updates only work for the installed app. Use git pull, or install the DMG.
- **Slug:** `update_from_source`

### FMM-U07

- **Message:** FixMyMix is running from the disk image. Drag it to Applications first.
- **What it means and what to do:** Copy FixMyMix to Applications, eject the disk image, and open it from Applications.
- **Slug:** `update_from_dmg`

### FMM-U08

- **Message:** macOS is running a temporary copy. Move FixMyMix to Applications and open it from there.
- **What it means and what to do:** macOS App Translocation: move the app to Applications and reopen it.
- **Slug:** `update_translocated`

### FMM-U09

- **Message:** The download helper stopped unexpectedly.
- **What it means and what to do:** Try the update again. If it repeats, install from the DMG.
- **Slug:** `update_helper_failed`

## Unexpected

### FMM-X01

- **Message:** Something went wrong on the server.
- **What it means and what to do:** An unexpected server fault. The details are in the log (FixMyMix menu → Open log); the show keeps running.
- **Slug:** `server_error`

### FMM-X02

- **Message:** Something went wrong on this page.
- **What it means and what to do:** An unexpected error in the page script. Reload the page. If it repeats, note what you pressed.
- **Slug:** `page_error`

### FMM-X99

- **Message:** Something went wrong.
- **What it means and what to do:** An error without a specific code. Reload; check the log on the FixMyMix laptop.
- **Slug:** `unknown`
