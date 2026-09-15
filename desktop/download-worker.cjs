// Runs as an Electron utility process: downloads an update while the main
// process may be paused by an open menu-bar menu (macOS runs menu tracking in
// a mode that stops the app's own code). Messages: { url, dest } in;
// { type: 'progress', fraction, received, total } / { type: 'done' } /
// { type: 'error', message } out.
process.parentPort.once('message', async ({ data }) => {
  try {
    const { download } = await import('./updater.js');
    let last = 0;
    await download(data.url, data.dest, {
      onProgress: (fraction, received, total) => {
        const now = Date.now();
        if (now - last < 250) return; // a few times a second is plenty
        last = now;
        process.parentPort.postMessage({ type: 'progress', fraction, received, total });
      },
    });
    process.parentPort.postMessage({ type: 'done' });
  } catch (error) {
    process.parentPort.postMessage({ type: 'error', message: error?.message || String(error) });
  }
});
