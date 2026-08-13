(function initUiTaskController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssUiTasks = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  function createUiTaskController({ document, diagnostics, formatError, logger = console }) {
    if (!document || typeof formatError !== 'function') {
      throw new Error('UI task controller requires document and error formatting');
    }

    function dismissGlobalError() {
      const notice = document.getElementById('globalErrorNotice');
      if (notice) notice.hidden = true;
    }

    function recordRendererDiagnostic(category) {
      try {
        const request = diagnostics?.recordRendererError(category);
        if (request && typeof request.catch === 'function') request.catch(() => {});
      } catch {
        // Diagnostics must never create a second application error.
      }
    }

    function reportUiError(context, error, diagnosticCategory = 'ui-error') {
      recordRendererDiagnostic(diagnosticCategory);
      logger.error(`${context}:`, error);
      const notice = document.getElementById('globalErrorNotice');
      const message = document.getElementById('globalErrorMessage');
      if (!notice || !message) return;
      message.textContent = formatError(context, error) || `${context}.`;
      notice.hidden = false;
    }

    function runUiTask(context, operation, onFailure) {
      return Promise.resolve()
        .then(operation)
        .catch(error => {
          if (typeof onFailure === 'function') {
            try {
              onFailure();
            } catch (recoveryError) {
              recordRendererDiagnostic('recovery-error');
              logger.error('UI recovery failed:', recoveryError);
            }
          }
          reportUiError(context, error);
        });
    }

    return Object.freeze({
      dismissGlobalError,
      recordRendererDiagnostic,
      reportUiError,
      runUiTask,
    });
  }

  return Object.freeze({ createUiTaskController });
});
