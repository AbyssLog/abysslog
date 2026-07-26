'use strict';

const http = require('node:http');

if (typeof WebSocket !== 'function') {
  throw new Error('This smoke test requires a Node.js runtime with WebSocket support');
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('A valid DevTools port is required');
  }
  return port;
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${pathname}`, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function findRendererTarget(port) {
  const deadline = Date.now() + 10_000;
  do {
    try {
      const targets = await getJson(port, '/json/list');
      const page = targets.find(target => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // The debugging endpoint may not be accepting connections yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('Packaged renderer target did not become available');
}

async function inspectRenderer(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Packaged renderer inspection timed out'));
    }, 5000);
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Packaged renderer debugging connection failed'));
    });
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          returnByValue: true,
          expression: `JSON.stringify({
            readyState: document.readyState,
            url: location.href,
            title: document.title,
            bodyText: document.body?.innerText?.slice(0, 1000) || '',
            activePage: document.querySelector('.page.active')?.id || null,
            hasApiBridge: Boolean(window.api?.auth && window.api?.runs),
            errorNoticeHidden: document.getElementById('globalErrorNotice')?.hidden,
            errorMessage: document.getElementById('globalErrorMessage')?.textContent || '',
          })`,
        },
      }));
    });
    socket.addEventListener('message', event => {
      const payload = JSON.parse(event.data);
      if (payload.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(payload.error || payload.result.exceptionDetails)));
        return;
      }
      resolve(JSON.parse(payload.result.result.value));
    });
  });
}

function isRendererInitialized(renderer) {
  const expectedUrl = 'abysslog-app://bundle/src/renderer/index.html';
  return Boolean(
    renderer
    && ['interactive', 'complete'].includes(renderer.readyState)
    && renderer.url === expectedUrl
    && renderer.title === 'AbyssLog'
    && renderer.activePage === 'page-tracker'
    && renderer.hasApiBridge === true
    && renderer.errorNoticeHidden === true
    && typeof renderer.bodyText === 'string'
    && renderer.bodyText.trim().length > 0
  );
}

async function waitForInitializedRenderer(page) {
  const deadline = Date.now() + 10_000;
  let renderer = null;
  do {
    renderer = await inspectRenderer(page);
    if (isRendererInitialized(renderer)) return renderer;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(
    `Packaged renderer did not initialize safely: ${JSON.stringify(renderer)}`
  );
}

async function main() {
  const port = parsePort(process.argv[2]);
  const page = await findRendererTarget(port);
  const renderer = await waitForInitializedRenderer(page);
  console.log(`Packaged renderer loaded successfully: ${renderer.url}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  module.exports = {
    isRendererInitialized,
    parsePort,
  };
}
