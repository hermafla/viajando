(() => {
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

  // Travelpayouts renders its popovers in an open shadow root.
  function installStyles() {
    const root = document.getElementById('tpwl-modals')?.shadowRoot;
    if (!root || root.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = calendarStyles;
    root.appendChild(style);
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

  new MutationObserver(scheduleInstall).observe(document.body, { childList: true });
  document.addEventListener('pointerdown', scheduleInstall, true);
  document.addEventListener('focusin', scheduleInstall, true);
  installStyles();
})();
