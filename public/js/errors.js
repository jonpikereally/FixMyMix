// Every error a person can see in FixMyMix has a stable code, shown next to
// the message as "(Error FMM-P06)". Paste the code into a chat with an LLM, or
// look it up in docs/ERRORS.md, to find out what happened and what to do.
//
// One table, shared by the server, the web pages and the menu-bar app. Keys
// are the machine slugs the API returns as `code`; `code` here is the
// human-facing reference. Never reuse or renumber a code: add new ones.
//
// Areas: C connection · R request · P performer · A admin & roster ·
// S band setups · H show log · J QR / join page · B browser features ·
// D Mac app & server · U updates · X unexpected.
//
// After adding or changing an entry, run `npm run errors:doc`.

// The public copy of this list (docs/ERRORS.md in the public GitHub repo), so
// an AI assistant with web access can read it. Each code has its own heading,
// so `helpUrl()` links straight to it. The app also serves the list itself at
// /errors, which works on the show Wi-Fi without internet.
export const ERRORS_DOC_URL = 'https://github.com/jonpikereally/FixMyMix/blob/main/docs/ERRORS.md';
export const ERRORS_RAW_URL = 'https://raw.githubusercontent.com/jonpikereally/FixMyMix/main/docs/ERRORS.md';

export const ERRORS = {
  // --- C: connection
  offline_stage: { code: 'FMM-C01', area: 'Connection', message: 'No connection to the mix desk.', help: 'The phone has lost the FixMyMix server. Check it is on the show Wi-Fi and that the FixMyMix laptop is awake and running. The page reconnects by itself.' },
  offline_admin: { code: 'FMM-C02', area: 'Connection', message: 'Lost connection to the server. Reconnecting…', help: 'The board has lost the FixMyMix server. Check the Wi-Fi and that FixMyMix is running on the laptop (menu bar icon). It reconnects by itself.' },
  unreachable: { code: 'FMM-C03', area: 'Connection', message: 'Cannot reach the FixMyMix server. Are you on the show Wi-Fi?', help: 'A tap or button press could not reach the server after several tries. Join the show Wi-Fi, make sure FixMyMix is running, then try again.' },

  // --- R: request
  bad_json: { code: 'FMM-R01', area: 'Request', message: 'The request could not be read.', help: 'The page sent something the server could not parse. Reload the page; if it keeps happening, update FixMyMix.' },
  too_large: { code: 'FMM-R02', area: 'Request', message: 'Request body too large.', help: 'The request was bigger than 256 KB. Usually an oversized setup file being imported.' },
  not_found: { code: 'FMM-R03', area: 'Request', message: 'No such endpoint.', help: 'The page asked for an API the server does not have. The page and the app are probably different versions: reload the page.' },
  page_not_found: { code: 'FMM-R04', area: 'Request', message: 'Page not found.', help: 'There is no page at that address. Use /stage for performers, /admin for the board, /join for the QR code.' },
  method_not_allowed: { code: 'FMM-R05', area: 'Request', message: 'Method not allowed.', help: 'Something tried to change a static page. Reload; nothing is wrong with the show.' },
  nothing_to_resolve: { code: 'FMM-R06', area: 'Request', message: 'Nothing to resolve.', help: 'Done was pressed without saying what was done. Reload the board.' },

  // --- P: performer actions
  unknown_member: { code: 'FMM-P01', area: 'Performer', message: 'That performer is no longer in the roster.', help: 'The desk changed the roster. Tap "Not me" and pick your name again.' },
  unknown_channel: { code: 'FMM-P02', area: 'Performer', message: 'That channel is no longer in your mix.', help: 'The desk removed or replaced that channel. The page refreshes the list; tap again on the channel you want.' },
  bad_direction: { code: 'FMM-P03', area: 'Performer', message: 'Request must be "more" or "less".', help: 'The page sent an unknown request type. Reload the page.' },
  unknown_request: { code: 'FMM-P04', area: 'Performer', message: 'That request has already been handled.', help: 'Someone already cleared or cancelled it. Nothing to do.' },
  request_throttled: { code: 'FMM-P05', area: 'Performer', message: 'Slow down — the request is already on the board.', help: 'Too many taps in a few seconds from one performer. The request is on the board; wait a moment.' },
  messaging_off: { code: 'FMM-P06', area: 'Performer', message: 'Messages are switched off for this show.', help: 'The desk has not turned on Allow messages. Admin: Setup → Allow messages.' },
  empty_message: { code: 'FMM-P07', area: 'Performer', message: 'Type a message first.', help: 'The message box was empty.' },
  message_throttled: { code: 'FMM-P08', area: 'Performer', message: 'Slow down — give the desk a moment.', help: 'More than six messages in ten seconds. Wait a few seconds and send again.' },
  unknown_message: { code: 'FMM-P09', area: 'Performer', message: 'That message has already been handled.', help: 'It was already marked done or read. Nothing to do.' },

  // --- A: admin, passcode, roster
  unauthorized: { code: 'FMM-A01', area: 'Admin', message: 'Admin passcode required.', help: 'This device is not logged in to the board, or the passcode was changed elsewhere. Enter the admin passcode (shown in the FixMyMix menu).' },
  wrong_passcode: { code: 'FMM-A02', area: 'Admin', message: 'Wrong passcode.', help: 'The admin passcode did not match. The engineer can see it in the FixMyMix menu-bar menu on the laptop running FixMyMix.' },
  login_throttled: { code: 'FMM-A03', area: 'Admin', message: 'Too many attempts. Wait a minute.', help: 'Eight wrong passcodes in a minute from one device. Wait a minute, then use the passcode from the FixMyMix menu.' },
  bad_new_passcode: { code: 'FMM-A04', area: 'Admin', message: 'Passcode must be 4 to 12 digits.', help: 'A new admin passcode must be digits only, 4 to 12 of them.' },
  empty_roster: { code: 'FMM-A05', area: 'Admin', message: 'Keep at least one performer in the roster.', help: 'The roster cannot be empty. Add a member before removing the last one.' },
  bad_member_count: { code: 'FMM-A06', area: 'Admin', message: 'Members must be 1–24.', help: 'Quick setup takes between 1 and 24 band members.' },
  bad_channel_count: { code: 'FMM-A07', area: 'Admin', message: 'Channels must be 1–16.', help: 'Quick setup takes between 1 and 16 channels per member.' },
  member_needs_channel: { code: 'FMM-A08', area: 'Admin', message: 'Every member needs at least one channel.', help: 'A member in the roster editor has no channels. Add one (or remove the member) before saving.' },
  too_many_members: { code: 'FMM-A09', area: 'Admin', message: 'Max 24 members.', help: 'A roster holds up to 24 members.' },
  too_many_channels: { code: 'FMM-A10', area: 'Admin', message: 'Max 16 channels per member.', help: 'Each member can have up to 16 channels.' },
  channel_name_missing: { code: 'FMM-A11', area: 'Admin', message: 'Type a channel name first.', help: 'Add to everyone needs a channel name.' },
  channel_exists_everyone: { code: 'FMM-A12', area: 'Admin', message: 'Everyone already has that channel.', help: 'No member was changed: they all have a channel with that name, or are at the 16-channel limit.' },

  // --- S: band setups
  bad_setup: { code: 'FMM-S01', area: 'Band setups', message: 'That is not a FixMyMix setup file.', help: 'The imported JSON is not a setup. Use a file made with Export in Setup → Band setups.' },
  setup_no_members: { code: 'FMM-S02', area: 'Band setups', message: 'That file has no band members in it.', help: 'The setup file is valid JSON but its members list is empty or unreadable.' },
  unknown_setup: { code: 'FMM-S03', area: 'Band setups', message: 'That setup is no longer saved.', help: 'It was deleted, perhaps from another device. Reopen the Setup tab to refresh the list.' },
  too_many_setups: { code: 'FMM-S04', area: 'Band setups', message: 'You can keep up to 50 setups. Delete one first.', help: 'The saved-setups list is full. Export any you want to keep, then delete some.' },
  setup_name_missing: { code: 'FMM-S05', area: 'Band setups', message: 'Give the setup a name first.', help: 'Type a name in the box before pressing Save current.' },
  setup_not_json: { code: 'FMM-S06', area: 'Band setups', message: 'That file is not valid JSON.', help: 'The file chosen for import could not be read as JSON. Pick a .json file exported from FixMyMix.' },

  // --- H: show log and report
  history_load_failed: { code: 'FMM-H01', area: 'Show log', message: 'Could not load the show log.', help: 'The History tab or report could not fetch the log. Check the connection and reload.' },

  // --- J: QR / join page
  no_address: { code: 'FMM-J01', area: 'QR codes', message: 'No network address yet — is the computer on Wi-Fi?', help: 'The laptop has no Wi-Fi or network address, so there is nothing to put in the QR code. Join the show network.' },
  ableset_host_missing: { code: 'FMM-J02', area: 'QR codes', message: 'Type the address of the computer running Ableton.', help: 'The AbleSet QR needs the address of the AbleSet computer.' },
  bad_port: { code: 'FMM-J03', area: 'QR codes', message: 'Port must be between 1 and 65535, or empty.', help: 'Leave the port empty for AbleSet unless it uses a non-standard one.' },
  custom_url_missing: { code: 'FMM-J04', area: 'QR codes', message: 'Type an address to encode.', help: 'The Any address tab needs a web address.' },
  bad_url: { code: 'FMM-J05', area: 'QR codes', message: 'That does not look like a web address.', help: 'Start it with http:// or https://.' },
  qr_too_long: { code: 'FMM-J06', area: 'QR codes', message: 'That address is too long for a QR code.', help: 'Use a shorter address.' },

  // --- B: browser features
  midi_unsupported: { code: 'FMM-B01', area: 'Browser', message: 'This browser has no Web MIDI. Safari (and every browser on iPhone/iPad) cannot do MIDI; use Chrome, Edge or Firefox on a laptop or Android.', help: 'Web MIDI is missing from Safari and all iOS browsers.' },
  midi_insecure: { code: 'FMM-B02', area: 'Browser', message: 'Browsers only allow MIDI on a secure page. On the computer running FixMyMix open http://localhost; on another laptop use the https:// address shown in the FixMyMix menu (accept the certificate once).', help: 'MIDI needs a secure context: localhost, or the https address.' },
  midi_denied: { code: 'FMM-B03', area: 'Browser', message: 'MIDI permission refused.', help: 'The browser blocked MIDI. Allow it in the site settings (the icon left of the address bar) and press Enable MIDI again.' },
  wake_lock_unsupported: { code: 'FMM-B04', area: 'Browser', message: 'Not available in this browser — turn off Auto-Lock in the phone\'s settings for the show instead.', help: 'This browser cannot keep the screen awake. On iPhone: Settings → Display & Brightness → Auto-Lock → Never.' },
  copy_failed: { code: 'FMM-B06', area: 'Browser', message: 'This browser would not copy the text.', help: 'Select the text shown under the code and copy it by hand (long-press on a phone).' },
  audio_unavailable: { code: 'FMM-B05', area: 'Browser', message: 'This browser cannot play the alert sound.', help: 'Web Audio is missing or blocked. The flash and red row still carry the alert.' },

  // --- D: the Mac app and the server process
  port_in_use: { code: 'FMM-D01', area: 'Mac app', message: 'The port is already in use.', help: 'Another program holds every port FixMyMix tries (80, 8080–8085, …). Quit the other program, or start FixMyMix with PORT set to a free port.' },
  server_start_failed: { code: 'FMM-D02', area: 'Mac app', message: 'The FixMyMix server could not start.', help: 'See the log (FixMyMix menu → Open log) for the reason, then choose Try again.' },
  no_https: { code: 'FMM-D03', area: 'Mac app', message: 'No https: the certificate could not be created.', help: 'openssl failed. http still works for phones; MIDI on other laptops needs https. Check the log.' },
  data_file_unreadable: { code: 'FMM-D04', area: 'Mac app', message: 'A data file could not be read and was ignored.', help: 'state.json, setups.json, history.json or config.json in the data folder is damaged. FixMyMix started without it.' },
  save_failed: { code: 'FMM-D05', area: 'Mac app', message: 'Could not save to the data folder.', help: 'The disk may be full or the folder read-only. Check free space.' },

  // --- U: updates
  update_check_failed: { code: 'FMM-U01', area: 'Updates', message: 'Could not check for updates.', help: 'GitHub could not be reached. The laptop needs internet to update; the show itself does not.' },
  update_download_failed: { code: 'FMM-U02', area: 'Updates', message: 'The update download failed.', help: 'The download was interrupted. Try again on a better connection.' },
  update_unpack_failed: { code: 'FMM-U03', area: 'Updates', message: 'Could not unpack the update.', help: 'The downloaded zip was damaged. Try again; or install from the DMG on the releases page.' },
  update_no_app: { code: 'FMM-U04', area: 'Updates', message: 'The update did not contain an app.', help: 'The release zip is broken. Install from the DMG on the releases page.' },
  update_version_mismatch: { code: 'FMM-U05', area: 'Updates', message: 'The downloaded update is a different version than expected.', help: 'The release was replaced while downloading. Check for updates again.' },
  update_from_source: { code: 'FMM-U06', area: 'Updates', message: 'FixMyMix is running from the source folder, not an installed app.', help: 'In-app updates only work for the installed app. Use git pull, or install the DMG.' },
  update_from_dmg: { code: 'FMM-U07', area: 'Updates', message: 'FixMyMix is running from the disk image. Drag it to Applications first.', help: 'Copy FixMyMix to Applications, eject the disk image, and open it from Applications.' },
  update_translocated: { code: 'FMM-U08', area: 'Updates', message: 'macOS is running a temporary copy. Move FixMyMix to Applications and open it from there.', help: 'macOS App Translocation: move the app to Applications and reopen it.' },
  update_helper_failed: { code: 'FMM-U09', area: 'Updates', message: 'The download helper stopped unexpectedly.', help: 'Try the update again. If it repeats, install from the DMG.' },

  // --- X: unexpected
  server_error: { code: 'FMM-X01', area: 'Unexpected', message: 'Something went wrong on the server.', help: 'An unexpected server fault. The details are in the log (FixMyMix menu → Open log); the show keeps running.' },
  page_error: { code: 'FMM-X02', area: 'Unexpected', message: 'Something went wrong on this page.', help: 'An unexpected error in the page script. Reload the page. If it repeats, note what you pressed.' },
  unknown: { code: 'FMM-X99', area: 'Unexpected', message: 'Something went wrong.', help: 'An error without a specific code. Reload; check the log on the FixMyMix laptop.' },
};

/** The FMM-… code for a slug; unknown slugs get FMM-X99. */
export function errorCode(slug) {
  return (ERRORS[slug] ?? ERRORS.unknown).code;
}

/** Public link to one code's entry: …/ERRORS.md#fmm-p06 (GitHub's heading anchor). */
export function helpUrl(code) {
  return `${ERRORS_DOC_URL}#${String(code).toLowerCase()}`;
}

/** The hover text every error carries: where to look the code up. */
export function errorTitle(code) {
  return `Error ${code}: check the error list page (/errors on this FixMyMix address) for what it means and what to do. Asking an AI assistant? Paste the message with its code and this link: ${helpUrl(code)}`;
}

/** The entry for an FMM- code, or null. */
export function findByCode(code) {
  const hit = Object.entries(ERRORS).find(([, e]) => e.code === code);
  return hit ? { slug: hit[0], ...hit[1] } : null;
}

/** Text to paste into an AI assistant: what was seen, what it means, where the full list is. */
export function llmPrompt(code, shownMessage) {
  const entry = findByCode(code) ?? { ...ERRORS.unknown };
  return [
    `I'm using FixMyMix (a stage monitor-mix request app) and got this error: "${shownMessage ?? entry.message}" (Error ${entry.code}).`,
    `FixMyMix's explanation of ${entry.code}: ${entry.help}`,
    `The full list of FixMyMix error codes is at ${helpUrl(entry.code)} (plain text: ${ERRORS_RAW_URL}).`,
    'What should I do?',
  ].join('\n');
}

/** "message (Error FMM-P06)" — how every error is shown to a person. */
export function withCode(message, code) {
  return `${message} (Error ${code})`;
}

/** An Error carrying both the slug (`code`) and the reference (`errorCode`). */
export function codedError(slug, message, extra = {}) {
  const entry = ERRORS[slug] ?? ERRORS.unknown;
  const error = new Error(message ?? entry.message);
  error.code = slug;
  error.errorCode = entry.code;
  return Object.assign(error, extra);
}

/** Text to show a person for any error, always with a code. */
export function describeError(error) {
  const slug = error?.code && ERRORS[error.code] ? error.code : null;
  const code = error?.errorCode ?? (slug ? ERRORS[slug].code : ERRORS.unknown.code);
  const message = error?.message || (slug ? ERRORS[slug].message : ERRORS.unknown.message);
  return withCode(message, code);
}
