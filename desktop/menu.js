// The tray menu as a plain template, so it can be unit-tested without Electron.

export function buildMenu(state, actions) {
  const items = [];
  const localUrl = `http://localhost:${state.port}`;

  if (state.starting) items.push({ label: 'Starting FixMyMix…', enabled: false });
  else if (state.running) items.push({ label: 'FixMyMix is running', enabled: false });
  else if (state.error) items.push({ label: `FixMyMix stopped: ${state.error}`, enabled: false });
  else items.push({ label: 'FixMyMix is stopped', enabled: false });

  if (state.running) {
    const devices = state.devices ?? 0;
    items.push({ label: `${devices} device${devices === 1 ? '' : 's'} connected`, enabled: false });
    items.push({ type: 'separator' });
    items.push({ label: 'Performers open (click to copy):', enabled: false });
    for (const url of state.urls) {
      items.push({ label: url, toolTip: 'Copy address', click: () => actions.copy(url) });
    }
    for (const url of state.httpsUrls ?? []) {
      items.push({ label: `${url}  (MIDI)`, toolTip: 'Copy https address — for MIDI controllers on other devices', click: () => actions.copy(url) });
    }
    items.push({ label: `Admin passcode: ${state.passcode}`, toolTip: 'Copy passcode', click: () => actions.copy(state.passcode) });
    items.push({ type: 'separator' });
    items.push({ label: 'Open admin board', click: () => actions.open(`${localUrl}/admin`) });
    items.push({ label: 'Open stage view', click: () => actions.open(`${localUrl}/stage`) });
    items.push({ label: 'Show QR code for performers', click: () => actions.open(`${localUrl}/join`) });
    items.push({ label: 'Show QR code for AbleSet', click: () => actions.open(`${localUrl}/join?app=ableset`) });
    if (!(state.httpsUrls ?? []).length) {
      items.push({ label: 'Set up HTTPS (for MIDI on other devices)…', click: () => actions.setupHttps() });
    }
  }

  items.push({ type: 'separator' });
  if (state.running) {
    items.push({ label: 'Stop server', click: () => actions.stop() });
  } else {
    items.push({ label: state.error ? 'Try again' : 'Start server', enabled: !state.starting, click: () => actions.start() });
  }
  items.push({ label: 'Start at login', type: 'checkbox', checked: state.loginItem, click: () => actions.toggleLogin() });
  items.push({ label: 'Keep Mac awake while running', type: 'checkbox', checked: state.keepAwake !== false, click: () => actions.toggleKeepAwake() });
  items.push({ type: 'separator' });
  items.push({ label: 'Open log', click: () => actions.openLog() });
  items.push({ label: 'Quit FixMyMix', click: () => actions.quit() });
  return items;
}
