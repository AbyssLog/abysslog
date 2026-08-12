(function initUiFormatters(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssUiFormatters = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createFormatters() {
  function formatIsk(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    const absolute = Math.abs(number);
    if (absolute >= 1e9) return (number / 1e9).toFixed(2) + 'B';
    if (absolute >= 1e6) return (number / 1e6).toFixed(2) + 'M';
    if (absolute >= 1e3) return (number / 1e3).toFixed(1) + 'K';
    return Math.round(number).toLocaleString();
  }

  function formatDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return '00:00:00';
    const whole = Math.floor(value);
    const hours = Math.floor(whole / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((whole % 3600) / 60).toString().padStart(2, '0');
    const remainder = (whole % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${remainder}`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return 'unknown size';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  return Object.freeze({ formatBytes, formatDuration, formatIsk });
});
