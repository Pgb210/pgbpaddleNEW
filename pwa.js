(() => {
  const installButtons = document.querySelectorAll('[data-pwa-install]');
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const helpDialog = document.getElementById('pwaInstallHelp');
  let installPrompt = null;
  let installPending = false;

  function updateInstallButtons() {
    const isStandalone = standaloneQuery.matches || navigator.standalone === true;
    installButtons.forEach(button => {
      button.hidden = isStandalone || (!installPrompt && !isAppleMobile);
      button.disabled = installPending;
      button.textContent = isAppleMobile && !installPrompt ? 'Add to Home Screen' : 'Install app';
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installButtons.forEach(button => { button.hidden = true; });
  });

  installButtons.forEach(button => {
    button.addEventListener('click', async () => {
      if (!installPrompt) {
        if (isAppleMobile && helpDialog && !helpDialog.open) helpDialog.showModal();
        return;
      }
      const pendingPrompt = installPrompt;
      installPrompt = null;
      installPending = true;
      updateInstallButtons();
      try {
        await pendingPrompt.prompt();
        await pendingPrompt.userChoice;
      } catch {
        if (helpDialog && !helpDialog.open) {
          document.getElementById('pwaHelpText').textContent =
            'Installation is not available right now. Use your browser’s menu to install this app, or try again on your next visit.';
          helpDialog.showModal();
        }
      } finally {
        installPending = false;
        updateInstallButtons();
      }
    });
  });

  standaloneQuery.addEventListener('change', updateInstallButtons);
  updateInstallButtons();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => { console.warn('PWA offline support is unavailable; online booking is unaffected.'); });
    });
  }
})();
