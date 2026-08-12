(function initNavigationController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssNavigation = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createNavigationModule() {
  function createNavigationController({ document, onShowPage }) {
    if (!document || typeof onShowPage !== 'function') {
      throw new TypeError('Navigation requires a document and page callback');
    }

    function show(name) {
      document.querySelectorAll('.page').forEach(page => {
        const isActive = page.id === `page-${name}`;
        page.classList.toggle('active', isActive);
        page.setAttribute('aria-hidden', String(!isActive));
      });
      document.querySelectorAll('.nav-btn').forEach(button => {
        const isActive = button.dataset.page === name;
        button.classList.toggle('active', isActive);
        if (isActive) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
      return onShowPage(name);
    }

    return Object.freeze({ show });
  }

  return Object.freeze({ createNavigationController });
});
