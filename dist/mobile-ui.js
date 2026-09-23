/** Reuse the existing controls in a mobile sheet; desktop keeps its original DOM. */
export function createMobileUI() {
  const mobile = matchMedia('(max-width: 760px), (pointer: coarse) and (max-width: 1024px)');
  const top = document.createElement('div');
  top.className = 'mobile-top';
  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'mobile-menu-button';
  menuButton.textContent = '☰  Menu';
  menuButton.setAttribute('aria-label', 'Open controls menu');
  menuButton.setAttribute('aria-haspopup', 'dialog');
  menuButton.setAttribute('aria-controls', 'mobile-menu');
  menuButton.setAttribute('aria-expanded', 'false');
  top.append(menuButton);

  const primary = document.createElement('div');
  primary.className = 'mobile-primary';
  const area = document.createElement('div');
  area.className = 'mobile-area';
  primary.append(area);

  const menu = document.createElement('dialog');
  menu.id = 'mobile-menu';
  menu.className = 'mobile-menu';
  menu.setAttribute('aria-labelledby', 'mobile-menu-title');
  menu.innerHTML = '<div class="mobile-menu-heading"><h2 id="mobile-menu-title">Explore</h2><button type="button" class="mobile-menu-close" aria-label="Close menu">×</button></div><div class="mobile-menu-scroll"><div class="mobile-menu-shared"><h3>Destination and time</h3></div><div class="mobile-menu-explore"><h3>Map tools</h3></div><div class="mobile-menu-drive"><h3>Driving</h3></div></div>';
  document.body.append(top, primary, menu);

  const shared = menu.querySelector('.mobile-menu-shared');
  const explore = menu.querySelector('.mobile-menu-explore');
  const drive = menu.querySelector('.mobile-menu-drive');
  const entries = [
    ['.map-tools', explore],
    ['.panel', explore],
    ['#destination', shared],
    ['label[for="time-of-day"]', shared],
    ['#time-of-day', shared],
    ['#day-skip', shared, true],
    ['#night-skip', shared],
    ['#sound-controls', shared],
    ['#about', shared],
    ['.drive-actions', drive],
    ['#drive-performance', drive],
    ['.multiplayer-open', drive],
    ['.multiplayer-driving', drive],
    ['#drive-exit', top],
    ['label[for="place"]', area],
    ['#place', area],
    ['#drive', primary],
  ].map(([selector, destination, parent = false]) => {
    const found = document.querySelector(selector);
    const element = parent ? found?.parentElement : found;
    if (!element) throw new Error(`Mobile layout is missing ${selector}`);
    const anchor = document.createComment(`mobile ${selector}`);
    element.before(anchor);
    return { element, anchor, destination };
  });

  const setMode = () => {
    if (menu.open) menu.close();
    menu.querySelector('#mobile-menu-title').textContent = document.body.classList.contains('driving') ? 'Driving' : 'Explore';
  };
  const updateLayout = () => {
    if (menu.open) menu.close();
    for (const { element, anchor, destination } of entries) {
      if (mobile.matches) destination.append(element);
      else anchor.after(element);
    }
    document.body.classList.toggle('mobile-layout', mobile.matches);
    setMode();
  };
  menuButton.addEventListener('click', () => {
    setMode();
    menu.showModal();
    menuButton.setAttribute('aria-expanded', 'true');
    menu.querySelector('.mobile-menu-close').focus();
  });
  menu.querySelector('.mobile-menu-close').addEventListener('click', () => menu.close());
  menu.addEventListener('click', event => {
    if (event.target === menu) { menu.close(); return; }
    if (event.target.closest('#home,#load,#city,#north,#top,#plus,#minus,#night-skip,#day-skip,#dusk-skip,#about,#export,#drive-camera,#drive-reset,.multiplayer-open')) menu.close();
  });
  menu.addEventListener('change', event => { if (event.target.id === 'destination') menu.close(); });
  menu.addEventListener('close', () => {
    menuButton.setAttribute('aria-expanded', 'false');
    if (document.querySelector('dialog[open]')) return;
    const next = mobile.matches ? menuButton : document.querySelector(document.body.classList.contains('driving') ? '#drive-exit' : '#place');
    next?.focus({ preventScroll: true });
  });
  for (const id of ['info', 'multiplayer-dialog']) document.getElementById(id)?.addEventListener('close', () => {
    if (mobile.matches && !menu.open) menuButton.focus({ preventScroll: true });
  });
  const observer = new MutationObserver(setMode);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  mobile.addEventListener('change', updateLayout);
  updateLayout();
}
