/* Capture a tab's immutable context before hydration or any application request. */
(function () {
  var match = /^\/_accounts\/([a-f0-9]{32})\//.exec(location.pathname);
  if (!match) return;
  var context = match[1], prefix = '/_accounts/' + context;
  function scoped(input) {
    var url = new URL(String(input), location.href);
    if (url.origin !== location.origin || /^(?:blob|data):/.test(url.protocol)) return url.href;
    if (url.pathname === '/accounts' || url.pathname.indexOf('/api/auth/retained') === 0 || url.pathname.indexOf('/_next/') === 0) return url.href;
    var existing = /^\/_accounts\/([a-f0-9]{32})(\/.*)$/.exec(url.pathname);
    if (existing && existing[1] !== context) throw new Error('Request belongs to another account');
    if (!existing) url.pathname = prefix + url.pathname;
    return url.href;
  }
  var originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (input instanceof Request) return originalFetch(new Request(scoped(input.url), input), init);
    return originalFetch(scoped(input), init);
  };
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments); args[1] = scoped(url);
    return open.apply(this, args);
  };
  if (navigator.sendBeacon) {
    var beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) { return beacon(scoped(url), data); };
  }
  if (window.EventSource) {
    var Source = window.EventSource;
    window.EventSource = function (url, config) { return new Source(scoped(url), config); };
    window.EventSource.prototype = Source.prototype;
  }
  // Plain anchors and forms (including modified-click/open-in-new-tab) keep the
  // context in their real DOM destination. Never retarget work to another identity.
  function anchors(root) {
    root.querySelectorAll('a[href],form[action]').forEach(function (node) {
      var attr = node.tagName === 'FORM' ? 'action' : 'href', raw = node.getAttribute(attr);
      if (!raw || raw.charAt(0) === '#' || /^(mailto|tel|javascript):/.test(raw)) return;
      try { var next = scoped(raw); if (next !== raw) node.setAttribute(attr, next); } catch (_) { /* explicit cross-account switch uses Accounts */ }
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    anchors(document);
    new MutationObserver(function () { anchors(document); }).observe(document.body, { childList: true, subtree: true });
  });
  window.__sneekAccountScope = { contextId: context, url: scoped };
})();
