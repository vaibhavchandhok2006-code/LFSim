async function setup() {
  Serial.println('escape test');
  const g = (function () {}).constructor('return this')();
  Serial.println('global found: ' + (typeof g));
  Serial.println('fetch: ' + typeof g.fetch + ', XMLHttpRequest: ' + typeof g.XMLHttpRequest + ', WebSocket: ' + typeof g.WebSocket);
  let p = g, found = [];
  while (p) { for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts']) if (Object.prototype.hasOwnProperty.call(p, k) && p[k]) found.push(k); p = Object.getPrototypeOf(p); }
  Serial.println('on prototype chain: ' + (found.join(',') || 'none'));
  try { if (g.fetch) await g.fetch('http://127.0.0.1:4174/beacon-fetch'); } catch (e) { Serial.println('fetch error'); }
  try { await import('http://127.0.0.1:4174/x.js'); Serial.println('import WORKED'); } catch (e) { Serial.println('import blocked'); }
  try { await import('data:text/javascript,export default 1'); Serial.println('data import WORKED'); } catch (e) { Serial.println('data import blocked'); }
}
async function loop() { await delay(100); }
