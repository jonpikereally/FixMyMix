# FixMyMix error codes

<!-- Generated from public/js/errors.js by `npm run errors:doc`. Do not edit by hand. -->

Every error FixMyMix shows ends with a code, for example **(Error FMM-P06)**. Find the code below to see what happened and what to do.
When asking an LLM for help, paste the whole message including the code.

The API returns the same information in every error body: `error` (the message), `code` (the slug below), `errorCode` (the FMM- code) and `help`.

## Connection

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-C01 | `offline_stage` | No connection to the mix desk. | The phone has lost the FixMyMix server. Check it is on the show Wi-Fi and that the FixMyMix laptop is awake and running. The page reconnects by itself. |
| FMM-C02 | `offline_admin` | Lost connection to the server. Reconnecting… | The board has lost the FixMyMix server. Check the Wi-Fi and that FixMyMix is running on the laptop (menu bar icon). It reconnects by itself. |
| FMM-C03 | `unreachable` | Cannot reach the FixMyMix server. Are you on the show Wi-Fi? | A tap or button press could not reach the server after several tries. Join the show Wi-Fi, make sure FixMyMix is running, then try again. |

## Request

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-R01 | `bad_json` | The request could not be read. | The page sent something the server could not parse. Reload the page; if it keeps happening, update FixMyMix. |
| FMM-R02 | `too_large` | Request body too large. | The request was bigger than 256 KB. Usually an oversized setup file being imported. |
| FMM-R03 | `not_found` | No such endpoint. | The page asked for an API the server does not have. The page and the app are probably different versions: reload the page. |
| FMM-R04 | `page_not_found` | Page not found. | There is no page at that address. Use /stage for performers, /admin for the board, /join for the QR code. |
| FMM-R05 | `method_not_allowed` | Method not allowed. | Something tried to change a static page. Reload; nothing is wrong with the show. |
| FMM-R06 | `nothing_to_resolve` | Nothing to resolve. | Done was pressed without saying what was done. Reload the board. |

## Performer

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-P01 | `unknown_member` | That performer is no longer in the roster. | The desk changed the roster. Tap "Not me" and pick your name again. |
| FMM-P02 | `unknown_channel` | That channel is no longer in your mix. | The desk removed or replaced that channel. The page refreshes the list; tap again on the channel you want. |
| FMM-P03 | `bad_direction` | Request must be "more" or "less". | The page sent an unknown request type. Reload the page. |
| FMM-P04 | `unknown_request` | That request has already been handled. | Someone already cleared or cancelled it. Nothing to do. |
| FMM-P05 | `request_throttled` | Slow down — the request is already on the board. | Too many taps in a few seconds from one performer. The request is on the board; wait a moment. |
| FMM-P06 | `messaging_off` | Messages are switched off for this show. | The desk has not turned on Allow messages. Admin: Setup → Allow messages. |
| FMM-P07 | `empty_message` | Type a message first. | The message box was empty. |
| FMM-P08 | `message_throttled` | Slow down — give the desk a moment. | More than six messages in ten seconds. Wait a few seconds and send again. |
| FMM-P09 | `unknown_message` | That message has already been handled. | It was already marked done or read. Nothing to do. |

## Admin

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-A01 | `unauthorized` | Admin passcode required. | This device is not logged in to the board, or the passcode was changed elsewhere. Enter the admin passcode (shown in the FixMyMix menu). |
| FMM-A02 | `wrong_passcode` | Wrong passcode. | The admin passcode did not match. It is shown in the FixMyMix menu-bar menu; the default is 1234. |
| FMM-A03 | `login_throttled` | Too many attempts. Wait a minute. | Eight wrong passcodes in a minute from one device. Wait a minute, then use the passcode from the FixMyMix menu. |
| FMM-A04 | `bad_new_passcode` | Passcode must be 4 to 12 digits. | A new admin passcode must be digits only, 4 to 12 of them. |
| FMM-A05 | `empty_roster` | Keep at least one performer in the roster. | The roster cannot be empty. Add a member before removing the last one. |
| FMM-A06 | `bad_member_count` | Members must be 1–24. | Quick setup takes between 1 and 24 band members. |
| FMM-A07 | `bad_channel_count` | Channels must be 1–16. | Quick setup takes between 1 and 16 channels per member. |
| FMM-A08 | `member_needs_channel` | Every member needs at least one channel. | A member in the roster editor has no channels. Add one (or remove the member) before saving. |
| FMM-A09 | `too_many_members` | Max 24 members. | A roster holds up to 24 members. |
| FMM-A10 | `too_many_channels` | Max 16 channels per member. | Each member can have up to 16 channels. |
| FMM-A11 | `channel_name_missing` | Type a channel name first. | Add to everyone needs a channel name. |
| FMM-A12 | `channel_exists_everyone` | Everyone already has that channel. | No member was changed: they all have a channel with that name, or are at the 16-channel limit. |

## Band setups

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-S01 | `bad_setup` | That is not a FixMyMix setup file. | The imported JSON is not a setup. Use a file made with Export in Setup → Band setups. |
| FMM-S02 | `setup_no_members` | That file has no band members in it. | The setup file is valid JSON but its members list is empty or unreadable. |
| FMM-S03 | `unknown_setup` | That setup is no longer saved. | It was deleted, perhaps from another device. Reopen the Setup tab to refresh the list. |
| FMM-S04 | `too_many_setups` | You can keep up to 50 setups. Delete one first. | The saved-setups list is full. Export any you want to keep, then delete some. |
| FMM-S05 | `setup_name_missing` | Give the setup a name first. | Type a name in the box before pressing Save current. |
| FMM-S06 | `setup_not_json` | That file is not valid JSON. | The file chosen for import could not be read as JSON. Pick a .json file exported from FixMyMix. |

## Show log

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-H01 | `history_load_failed` | Could not load the show log. | The History tab or report could not fetch the log. Check the connection and reload. |

## QR codes

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-J01 | `no_address` | No network address yet — is the computer on Wi-Fi? | The laptop has no Wi-Fi or network address, so there is nothing to put in the QR code. Join the show network. |
| FMM-J02 | `ableset_host_missing` | Type the address of the computer running Ableton. | The AbleSet QR needs the address of the AbleSet computer. |
| FMM-J03 | `bad_port` | Port must be between 1 and 65535, or empty. | Leave the port empty for AbleSet unless it uses a non-standard one. |
| FMM-J04 | `custom_url_missing` | Type an address to encode. | The Any address tab needs a web address. |
| FMM-J05 | `bad_url` | That does not look like a web address. | Start it with http:// or https://. |
| FMM-J06 | `qr_too_long` | That address is too long for a QR code. | Use a shorter address. |

## Browser

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-B01 | `midi_unsupported` | This browser has no Web MIDI. Safari (and every browser on iPhone/iPad) cannot do MIDI; use Chrome, Edge or Firefox on a laptop or Android. | Web MIDI is missing from Safari and all iOS browsers. |
| FMM-B02 | `midi_insecure` | Browsers only allow MIDI on a secure page. On the computer running FixMyMix open http://localhost; on another laptop use the https:// address shown in the FixMyMix menu (accept the certificate once). | MIDI needs a secure context: localhost, or the https address. |
| FMM-B03 | `midi_denied` | MIDI permission refused. | The browser blocked MIDI. Allow it in the site settings (the icon left of the address bar) and press Enable MIDI again. |
| FMM-B04 | `wake_lock_unsupported` | Not available in this browser — turn off Auto-Lock in the phone's settings for the show instead. | This browser cannot keep the screen awake. On iPhone: Settings → Display & Brightness → Auto-Lock → Never. |
| FMM-B05 | `audio_unavailable` | This browser cannot play the alert sound. | Web Audio is missing or blocked. The flash and red row still carry the alert. |

## Mac app

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-D01 | `port_in_use` | The port is already in use. | Another program holds every port FixMyMix tries (80, 8080–8085, …). Quit the other program, or start FixMyMix with PORT set to a free port. |
| FMM-D02 | `server_start_failed` | The FixMyMix server could not start. | See the log (FixMyMix menu → Open log) for the reason, then choose Try again. |
| FMM-D03 | `no_https` | No https: the certificate could not be created. | openssl failed. http still works for phones; MIDI on other laptops needs https. Check the log. |
| FMM-D04 | `data_file_unreadable` | A data file could not be read and was ignored. | state.json, setups.json, history.json or config.json in the data folder is damaged. FixMyMix started without it. |
| FMM-D05 | `save_failed` | Could not save to the data folder. | The disk may be full or the folder read-only. Check free space. |

## Updates

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-U01 | `update_check_failed` | Could not check for updates. | GitHub could not be reached. The laptop needs internet to update; the show itself does not. |
| FMM-U02 | `update_download_failed` | The update download failed. | The download was interrupted. Try again on a better connection. |
| FMM-U03 | `update_unpack_failed` | Could not unpack the update. | The downloaded zip was damaged. Try again; or install from the DMG on the releases page. |
| FMM-U04 | `update_no_app` | The update did not contain an app. | The release zip is broken. Install from the DMG on the releases page. |
| FMM-U05 | `update_version_mismatch` | The downloaded update is a different version than expected. | The release was replaced while downloading. Check for updates again. |
| FMM-U06 | `update_from_source` | FixMyMix is running from the source folder, not an installed app. | In-app updates only work for the installed app. Use git pull, or install the DMG. |
| FMM-U07 | `update_from_dmg` | FixMyMix is running from the disk image. Drag it to Applications first. | Copy FixMyMix to Applications, eject the disk image, and open it from Applications. |
| FMM-U08 | `update_translocated` | macOS is running a temporary copy. Move FixMyMix to Applications and open it from there. | macOS App Translocation: move the app to Applications and reopen it. |
| FMM-U09 | `update_helper_failed` | The download helper stopped unexpectedly. | Try the update again. If it repeats, install from the DMG. |

## Unexpected

| Code | Slug | Message | What to do |
| --- | --- | --- | --- |
| FMM-X01 | `server_error` | Something went wrong on the server. | An unexpected server fault. The details are in the log (FixMyMix menu → Open log); the show keeps running. |
| FMM-X02 | `page_error` | Something went wrong on this page. | An unexpected error in the page script. Reload the page. If it repeats, note what you pressed. |
| FMM-X99 | `unknown` | Something went wrong. | An error without a specific code. Reload; check the log on the FixMyMix laptop. |
