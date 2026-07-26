(function() {
  // Fade in logo then fade out whole splash
  const splash = document.getElementById('splash');
  const logo = document.getElementById('splashLogo');
  // Small delay then fade logo in
  setTimeout(() => { logo.style.opacity = '1'; }, 100);
  // After logo has been visible, fade splash out and remove
  setTimeout(() => { splash.style.opacity = '0'; }, 1800);
  setTimeout(() => { splash.remove(); }, 2400);
})();
