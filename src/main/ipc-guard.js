function createIpcGuard({
  ipcMain,
  security,
  getMainWindow,
  isBlocked = () => false,
  recordFailure = () => {},
  maxJsonBytes = 2 * 1024 * 1024,
}) {
  if (!ipcMain?.handle || !security || typeof getMainWindow !== 'function') {
    throw new TypeError('IPC guard requires ipcMain, validation, and a window provider');
  }

  function validateSender(event) {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return false;
    return (
      event.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame
      && event.senderFrame.url === window.webContents.getURL()
    );
  }

  function secureHandle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!validateSender(event)) {
        const error = new Error('Unauthorized IPC sender');
        recordFailure('ipc.rejected', { context: channel }, error);
        throw error;
      }
      if (isBlocked()) {
        throw new Error('AbyssLog is restarting after restoring a backup');
      }
      try {
        return await handler(...args);
      } catch (error) {
        recordFailure('ipc.failure', { context: channel }, error);
        throw error;
      }
    });
  }

  function validateObjectPayload(value, label, maxBytes = maxJsonBytes) {
    if (!security.isPlainObject(value)) throw new TypeError(`${label} must be an object`);
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) {
      throw new TypeError(`${label} is too large`);
    }
    return value;
  }

  function validateOptionalCharacterId(value) {
    return value === null || value === undefined || value === ''
      ? null
      : security.requireInteger(value, 'Character ID');
  }

  return Object.freeze({
    secureHandle,
    validateObjectPayload,
    validateOptionalCharacterId,
    validateSender,
  });
}

module.exports = { createIpcGuard };
