(() => {
  document.documentElement.dataset.valijeandoCalendar = 'ready';
  const styleId = 'valijeando-flight-calendar-viewport';
  const calendarStyles = `
    @media (min-width: 768px) {
      [data-testid="date-range-picker-popover-root"] {
        position: fixed !important;
        top: calc(50vh + 40px) !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        transform: translate(-50%, -50%) !important;
        max-width: calc(100vw - 32px) !important;
        max-height: calc(100vh - 112px) !important;
        max-height: calc(100dvh - 112px) !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        overscroll-behavior: contain;
        z-index: 160 !important;
        transition: none !important;
      }
      [data-testid="date-range-picker-popover-root"] > div {
        min-height: 0 !important;
        max-width: 100% !important;
      }
      [data-testid="date-range-picker-popover-root"] [class*="Calendar-module__root___"] {
        --rdp-cell-size: clamp(2rem, calc((100vw - 128px) / 14), 3rem) !important;
      }
    }
  `;

  const observedRoots = new WeakSet();
  let activeField = null;
  let pendingMonth = null;
  let departureHeading = null;
  let restoreAttempts = 0;
  let internalClick = false;

  function clickNative(element) {
    if (!element) return;
    internalClick = true;
    try { element.click(); } finally { internalClick = false; }
  }

  function monthNumber(key) {
    const [year, month] = key.split('-').map(Number);
    return year * 12 + month - 1;
  }

  function restoreVisibleMonth(root) {
    if (!pendingMonth) return;
    const picker = root.querySelector('[data-testid="date-range-picker-popover-root"]');
    // Wait for the native picker to switch to return selection before restoring.
    // This prevents clearing the saved month while the departure view is still open.
    if (picker && picker.querySelector('h4')?.textContent === departureHeading) return;
    if (++restoreAttempts > 24) { pendingMonth = null; return; }
    if (!picker) {
      const searchRoot = document.getElementById('tpwl-search')?.shadowRoot;
      clickNative(searchRoot?.querySelector('[data-testid="date-range-return-input"]'));
      scheduleInstall();
      return;
    }
    const month = picker.querySelector('[data-testid="date-range-picker-month-caption-0"]')?.dataset.monthKey;
    if (!month) { pendingMonth = null; return; }
    if (month === pendingMonth) { pendingMonth = null; return; }
    const direction = monthNumber(month) > monthNumber(pendingMonth) ? 'previous' : 'next';
    const arrow = picker.querySelector(`[data-testid="date-range-picker-${direction}-month-button"]`);
    if (!arrow || arrow.disabled) { pendingMonth = null; return; }
    clickNative(arrow);
    queueMicrotask(installStyles);
  }

  // Travelpayouts renders its popovers in an open shadow root.
  function installStyles() {
    const root = document.getElementById('tpwl-modals')?.shadowRoot;
    if (!root) return;
    if (!root.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = calendarStyles;
      root.appendChild(style);
    }
    if (!observedRoots.has(root)) {
      observedRoots.add(root);
      // Restore during the DOM update, before the next paint, so the old return
      // month does not flash on screen between the two selections.
      new MutationObserver(installStyles).observe(root, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['data-month-key']
      });
    }
    restoreVisibleMonth(root);
  }

  let scheduled = false;
  function scheduleInstall() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      installStyles();
    });
  }

  new MutationObserver(scheduleInstall).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', scheduleInstall, true);
  function trackField(event) {
    if (internalClick) return;
    const path = event.composedPath();
    if (path.some(node => node.dataset?.testid?.includes('clear-button'))) {
      pendingMonth = null;
      activeField = null;
      return;
    }
    const field = path.find(node => /^date-range-(departure|return)-input(?:-root)?$/.test(node.dataset?.testid || ''));
    if (field) {
      activeField = field.dataset.testid.includes('departure') ? 'departure' : 'return';
      if (!pendingMonth) restoreAttempts = 0;
    }
    scheduleInstall();
  }
  document.addEventListener('focusin', trackField, true);
  document.addEventListener('click', event => {
    if (internalClick) return;
    trackField(event);
    const button = event.composedPath().find(node => node.matches?.('button[name="day"]'));
    if (!button || button.disabled) return;
    if (activeField === 'departure') {
      const root = document.getElementById('tpwl-modals')?.shadowRoot;
      pendingMonth = root?.querySelector('[data-testid="date-range-picker-month-caption-0"]')?.dataset.monthKey || null;
      departureHeading = root?.querySelector('[data-testid="date-range-picker-popover-root"] h4')?.textContent || null;
      restoreAttempts = 0;
      activeField = 'return';
      scheduleInstall();
    } else {
      pendingMonth = null;
      activeField = null;
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { pendingMonth = null; activeField = null; }
  }, true);
  installStyles();
})();
