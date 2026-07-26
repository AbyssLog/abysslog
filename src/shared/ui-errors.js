(function exposeUiErrors(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssUiErrors = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_CONTEXT = 'AbyssLog could not complete the action';
  const SENSITIVE_VALUE_PATTERN =
    /\b(access[_ -]?token|refresh[_ -]?token|api[_ -]?key|client[_ -]?secret|authorization)(\s*[:=]\s*)([^\s,;]+)/gi;
  const SENSITIVE_QUERY_PATTERN =
    /([?&](?:access_token|refresh_token|api[_-]?key|client_secret|code|state)=)[^&#\s]+/gi;
  const BEARER_PATTERN = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;

  function cleanText(value, maxLength) {
    const text = String(value ?? '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  function sanitizeUiErrorDetail(value) {
    return cleanText(value, 2000)
      .replace(BEARER_PATTERN, '$1 [redacted]')
      .replace(SENSITIVE_VALUE_PATTERN, '$1$2[redacted]')
      .replace(SENSITIVE_QUERY_PATTERN, '$1[redacted]');
  }

  function errorDetail(error) {
    const raw = typeof error === 'string'
      ? error
      : (error && typeof error.message === 'string' ? error.message : '');
    return sanitizeUiErrorDetail(raw)
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '');
  }

  function formatUiError(context, error) {
    const safeContext = cleanText(context, 160) || DEFAULT_CONTEXT;
    const detail = cleanText(errorDetail(error), 240);
    if (!detail || detail.toLocaleLowerCase() === safeContext.toLocaleLowerCase()) {
      return /[.!?]$/.test(safeContext) ? safeContext : `${safeContext}.`;
    }
    return `${safeContext}: ${detail}`;
  }

  return {
    formatUiError,
    sanitizeUiErrorDetail,
  };
});
