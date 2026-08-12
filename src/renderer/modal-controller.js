(function initModalController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssModals = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModalModule() {
  const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function createModalController({ document, onRequestClose, onDidClose }) {
    if (!document) throw new TypeError('Modal controller requires a document');
    const returnFocus = new Map();
    const view = document.defaultView || globalThis;

    function focusableElements(overlay) {
      return [...overlay.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter(element => element.getClientRects().length > 0);
    }

    function open(id) {
      const overlay = document.getElementById(id);
      if (!overlay) return;
      const activeElement = document.activeElement;
      if (activeElement && !overlay.contains(activeElement)) {
        returnFocus.set(id, activeElement);
      }
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      const app = document.querySelector('.app');
      if (app) app.inert = true;
      view.requestAnimationFrame(() => {
        const initialFocus = overlay.querySelector('[data-initial-focus]')
          || focusableElements(overlay)[0]
          || overlay.querySelector('.modal');
        initialFocus?.focus();
      });
    }

    function close(id) {
      const overlay = document.getElementById(id);
      if (!overlay) return;
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      const anotherModalIsOpen = document.querySelector('.modal-overlay.open');
      const app = document.querySelector('.app');
      if (app) app.inert = Boolean(anotherModalIsOpen);
      const target = returnFocus.get(id);
      returnFocus.delete(id);
      if (!anotherModalIsOpen && target?.isConnected) target.focus();
      onDidClose?.(id);
    }

    function requestClose(id) {
      if (onRequestClose) return onRequestClose(id, close);
      return close(id);
    }

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', event => {
        if (event.target === overlay) requestClose(overlay.id);
      });
    });

    document.addEventListener('keydown', event => {
      const openModals = [...document.querySelectorAll('.modal-overlay.open')];
      const overlay = openModals.at(-1);
      if (!overlay) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose(overlay.id);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableElements(overlay);
      if (focusable.length === 0) {
        event.preventDefault();
        overlay.querySelector('.modal')?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    return Object.freeze({ close, focusableElements, open, requestClose });
  }

  return Object.freeze({ createModalController });
});
