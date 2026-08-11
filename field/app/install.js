/**
 * Getting the app onto the phone.
 *
 * A scanned QR code opens a browser tab, and a browser tab is not the app: no
 * icon on the home screen, no offline queue anyone can find again, and Safari
 * will quietly drop the tab. So the first thing a tech sees after scanning is
 * how to finish the job.
 *
 * The order matters and is the reason this leads the login screen rather than
 * sitting under it. On an iPhone an installed web app gets its own storage,
 * separate from Safari's — sign in first and the sign-in does not come with
 * you, so the tech does it twice and reasonably concludes the app is broken.
 * Install first, sign in inside the app.
 */

const ua = navigator.userAgent || '';

/** Running from the home screen rather than in a browser tab. */
export function installed() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator.standalone === true
  );
}

export function platform() {
  // An iPad on recent iPadOS reports itself as a Mac and is given away only by
  // having a touch screen.
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

// Chrome fires this instead of showing its own banner, and only inside the
// manifest's scope. Caught at load because it fires once, early — by the time
// a screen renders it has already come and gone.
let prompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  prompt = e;
  document.dispatchEvent(new Event('installable'));
});
window.addEventListener('appinstalled', () => { prompt = null; });

const STEPS = {
  ios: [
    'Tap the Share button at the bottom of Safari — the square with the arrow.',
    'Scroll down and tap <b>Add to Home Screen</b>.',
    'Tap <b>Add</b>, then open HouseMaster from your home screen.',
  ],
  android: [
    'Tap the <b>⋮</b> menu at the top right of Chrome.',
    'Tap <b>Install app</b>, or <b>Add to Home screen</b>.',
    'Tap <b>Install</b>, then open HouseMaster from your home screen.',
  ],
};

const node = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/**
 * The full card, for the login screen. Null once the app is installed, so a
 * tech signing in from the home screen never sees instructions for something
 * they have already done.
 */
export function installCard() {
  if (installed()) return null;
  const p = platform();

  if (p === 'other') {
    return node(`
      <div class="install">
        <h2>Open this on your phone</h2>
        <p>HouseMaster Field is built for a phone in a driveway. Scan the code
           the office sent you, or open this address on your phone.</p>
      </div>`);
  }

  const card = node(`
    <div class="install">
      <h2>Add HouseMaster to your home screen</h2>
      <p><b>Do this before you sign in.</b> The installed app keeps its own
         login, so signing in here first means signing in twice.</p>
      <ol>${STEPS[p].map((s) => `<li>${s}</li>`).join('')}</ol>
    </div>`);

  // Android can do it in one tap. The steps stay underneath: the button is
  // gone in a browser Chrome does not offer to install from, and a tech
  // reading a card with no way forward is worse than one extra paragraph.
  if (p === 'android') {
    const btn = node('<button class="btn primary install-now">Install now</button>');
    btn.hidden = !prompt;
    btn.onclick = async () => {
      if (!prompt) return;
      btn.disabled = true;
      prompt.prompt();
      await prompt.userChoice.catch(() => {});
      prompt = null;
      btn.hidden = true;
      btn.disabled = false;
    };
    document.addEventListener('installable', () => { btn.hidden = false; });
    card.append(btn);
  }
  return card;
}

const HIDDEN = 'hm.install.hidden';

/**
 * The one-line version, for a tech already signed in to a browser tab who
 * would otherwise never see the card again. Dismissible and stays dismissed —
 * it is a nudge, not a gate.
 */
export function installNudge(onChange) {
  if (installed() || localStorage.getItem(HIDDEN) === '1') return null;
  if (platform() === 'other') return null;

  const bar = node(`
    <div class="install-nudge">
      <span>You are in a browser tab. Add HouseMaster to your home screen so
            it is one tap away and keeps working with no signal.</span>
      <button class="link">Show me how</button>
      <button class="link dim">Hide</button>
    </div>`);

  const [how, hide] = bar.querySelectorAll('button');
  how.onclick = () => {
    const card = installCard();
    if (card) bar.replaceWith(card);
  };
  hide.onclick = () => {
    localStorage.setItem(HIDDEN, '1');
    bar.remove();
    onChange?.();
  };
  return bar;
}
