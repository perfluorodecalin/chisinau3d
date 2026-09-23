const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Mounts room controls and returns the interface used by the transport layer. */
export function createMultiplayerUI({ onJoin, onLeave } = {}) {
  const panel = document.querySelector('.panel');
  if (!panel) throw new Error('Multiplayer UI needs the city panel in the document.');

  const section = document.createElement('section');
  section.className = 'multiplayer';
  section.setAttribute('aria-labelledby', 'multiplayer-title');
  section.innerHTML = `
    <div class="divider"></div>
    <h2 class="eyebrow" id="multiplayer-title">DRIVE TOGETHER</h2>
    <label for="multiplayer-code">Room code or share link</label>
    <input id="multiplayer-code" class="multiplayer-code" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste a room code or link" aria-describedby="multiplayer-help multiplayer-message">
    <small id="multiplayer-help">Create a room, then send the link to a friend. Room links are invite capabilities. Public relays help peers find each other; direct connections can reveal your IP address to other peers.</small>
    <div class="multiplayer-actions"><button type="button" data-action="create">Create room</button><button type="button" data-action="join">Join room</button></div>
    <button type="button" class="multiplayer-copy" data-action="copy" disabled>Copy share link</button>
    <button type="button" class="multiplayer-copy" data-action="leave" hidden>Leave room</button>
    <p class="multiplayer-message" id="multiplayer-message" role="status" aria-live="polite">Not connected</p>`;
  const placeSectionInPanel = () => panel.insertBefore(section, panel.children[1] || null);
  placeSectionInPanel();

  const dialog = document.createElement('dialog');
  dialog.className = 'multiplayer-dialog';
  dialog.id = 'multiplayer-dialog';
  dialog.setAttribute('aria-labelledby', 'multiplayer-dialog-title');
  const dialogHeader = document.createElement('div');
  dialogHeader.className = 'multiplayer-dialog-header';
  dialogHeader.innerHTML = '<h2 id="multiplayer-dialog-title">Play together</h2><button type="button" class="multiplayer-dialog-close" aria-label="Close multiplayer controls">×</button>';
  dialog.append(dialogHeader);
  document.body.append(dialog);

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'multiplayer-open';
  openButton.textContent = 'Multiplayer';
  openButton.hidden = true;
  openButton.setAttribute('aria-haspopup', 'dialog');
  openButton.setAttribute('aria-controls', dialog.id);
  const driveTop = document.querySelector('#drive-hud .drive-top');
  if (driveTop) driveTop.insertBefore(openButton, driveTop.querySelector('#drive-exit') || null);
  else document.body.append(openButton);

  const bar = document.createElement('section');
  bar.className = 'multiplayer-driving';
  bar.setAttribute('aria-label', 'Multiplayer connection');
  bar.innerHTML = '<span class="multiplayer-driving-status" role="status" aria-live="polite">Not connected</span><span class="multiplayer-driving-peers"></span><button type="button" data-action="leave" hidden>Leave room</button>';
  document.body.append(bar);

  const input = section.querySelector('input');
  const message = section.querySelector('.multiplayer-message');
  const copyButton = section.querySelector('[data-action="copy"]');
  const panelLeaveButton = section.querySelector('[data-action="leave"]');
  const peerLabel = bar.querySelector('.multiplayer-driving-peers');
  const barLeaveButton = bar.querySelector('[data-action="leave"]');
  const drivingStatus = bar.querySelector('.multiplayer-driving-status');
  const closeButton = dialogHeader.querySelector('button');
  let room = '';
  let peerCount = 0;
  let roomActive = false;

  const statusText = (value) => {
    const text = String(value ?? '');
    message.textContent = text || 'Not connected';
    drivingStatus.textContent = text || 'Not connected';
    bar.classList.toggle('room-active', roomActive);
  };
  const setRoom = (value) => {
    const candidate = String(value ?? '').trim();
    room = UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : '';
    roomActive = Boolean(room);
    copyButton.disabled = !room;
    panelLeaveButton.hidden = !room;
    barLeaveButton.hidden = !room;
    bar.classList.toggle('room-active', roomActive);
    input.value = room;
    if (!room) {
      const url = new URL(location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        history.replaceState(history.state, '', url);
      }
    }
    updatePeerCount(peerCount);
    setDrivingMode();
  };
  const updatePeerCount = (count) => {
    peerCount = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
    const label = `${peerCount} ${peerCount === 1 ? 'peer' : 'peers'}`;
    peerLabel.textContent = roomActive ? label : '';
    openButton.textContent = roomActive ? `Multiplayer · ${peerCount}` : 'Multiplayer';
    openButton.setAttribute('aria-label', roomActive ? `Multiplayer room active, ${label}` : 'Multiplayer');
    openButton.title = roomActive ? `Room active · ${label}` : 'Open multiplayer controls';
    bar.dataset.peerCount = String(peerCount);
  };
  const extractRoom = (raw) => {
    const text = String(raw ?? '').trim();
    let candidate = text;
    if (/^https?:\/\//i.test(text)) {
      try { candidate = new URL(text).searchParams.get('room') || ''; }
      catch { return ''; }
    }
    return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : '';
  };
  const invokeJoin = async (id) => {
    if (!id) {
      statusText('Enter a valid room code or share link.');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    statusText('Connecting…');
    try {
      if (typeof onJoin !== 'function') throw new Error('Multiplayer is not available yet.');
      await onJoin(id);
    } catch (error) {
      statusText(error?.message || 'Could not join this room. Check the code and try again.');
    }
  };
  const createRoom = () => {
    if (!globalThis.crypto?.randomUUID) {
      statusText('Secure room creation requires a modern browser over HTTPS or localhost.');
      return;
    }
    void invokeJoin(globalThis.crypto.randomUUID().toLowerCase());
  };
  const leave = async () => {
    try { await onLeave?.(); }
    catch (error) {
      statusText(error?.message || 'Could not leave the room cleanly.');
      return;
    }
    setRoom('');
    updatePeerCount(0);
    statusText('Left room.');
  };

  const setDrivingMode = () => {
    const driving = document.body.classList.contains('driving');
    openButton.hidden = !driving;
    bar.hidden = !driving || !roomActive;
    if (driving && section.parentElement !== dialog) dialog.append(section);
    else if (!driving && section.parentElement !== panel) placeSectionInPanel();
    if (!driving && dialog.open) dialog.close();
  };
  const modeObserver = new MutationObserver(setDrivingMode);
  modeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  setDrivingMode();

  section.addEventListener('click', async (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'create') createRoom();
    if (action === 'join') await invokeJoin(extractRoom(input.value));
    if (action === 'leave') await leave();
    if (action === 'copy' && room) {
      const link = new URL(location.href);
      link.searchParams.set('room', room);
      try {
        await navigator.clipboard.writeText(link.href);
        copyButton.textContent = 'Link copied';
        setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = 'Copy share link'; }, 1600);
      } catch {
        copyButton.textContent = 'Select room code below';
        input.focus();
        input.select();
        setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = 'Copy share link'; }, 2200);
      }
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void invokeJoin(extractRoom(input.value));
  });
  openButton.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  barLeaveButton.addEventListener('click', leave);

  // An invite link only fills the room field. Joining always requires a user action.
  const prefill = new URL(location.href).searchParams.get('room');
  if (prefill) {
    const id = extractRoom(prefill);
    if (id) {
      input.value = id;
      statusText('Room link ready. Join when you’re ready.');
    } else {
      statusText('The room link has an invalid room code.');
      input.setAttribute('aria-invalid', 'true');
    }
  }

  return {
    setStatus(text) { statusText(text); },
    setPeerCount: updatePeerCount,
    setRoom,
    dispose() {
      modeObserver.disconnect();
      section.remove();
      dialog.remove();
      openButton.remove();
      bar.remove();
    }
  };
}
