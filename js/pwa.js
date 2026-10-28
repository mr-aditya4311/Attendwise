/* AttendWise install lifecycle. Vanilla JS, no dependencies. */
(function () {
  'use strict';

  var SESSION_KEY = 'attendwise-install-dismissed';
  var deferredPrompt = null;
  var modal = null;
  var lastFocus = null;

  function sessionDismissed() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return false; }
  }
  function markDismissed() {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) { /* storage blocked: in-memory only */ }
  }

  function isStandalone() {
    if (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches)) return true;
    return window.navigator.standalone === true; // iOS home-screen launch
  }

  function isIOSDevice() {
    var ua = navigator.userAgent || '';
    var iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /iPhone|iPad|iPod/.test(ua) || iPadOS;
  }

  function isIOSSafari() {
    var ua = navigator.userAgent || '';
    // Safari on iOS only (has the Share sheet); other iOS browsers get no manual steps.
    return isIOSDevice() && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  }

  function $(id) { return document.getElementById(id); }

  function setContent(m) {
    $('pwa-install').hidden = m !== 'native';
    $('pwa-ios').hidden = m !== 'ios';
    $('pwa-note').hidden = true;
    $('pwa-note').textContent = '';
  }

  function showNote(text) {
    $('pwa-note').textContent = text;
    $('pwa-note').hidden = false;
  }

  function focusables() {
    return Array.prototype.slice.call(modal.querySelectorAll('button:not([disabled]), a[href]'))
      .filter(function (el) { return el.offsetParent !== null; });
  }

  function openModal(m) {
    if (!modal || modal.hasAttribute('data-open')) return;
    setContent(m);
    lastFocus = document.activeElement;
    modal.removeAttribute('hidden');
    modal.setAttribute('data-open', '1');
    var app = document.querySelector('.app');
    if (app) app.setAttribute('inert', '');
    var first = m === 'native' ? $('pwa-install-btn') : $('pwa-close-ios');
    if (first) first.focus();
  }

  function closeModal(remember) {
    if (!modal || !modal.hasAttribute('data-open')) return;
    modal.removeAttribute('data-open');
    modal.setAttribute('hidden', '');
    var app = document.querySelector('.app');
    if (app) app.removeAttribute('inert');
    if (remember) markDismissed();
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function onKeydown(ev) {
    if (!modal || !modal.hasAttribute('data-open')) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeModal(true);
      return;
    }
    if (ev.key === 'Tab') {
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  }

  async function onInstallClick() {
    var btn = $('pwa-install-btn');
    if (!deferredPrompt) {
      showNote('Install is not available right now. Use your browser menu and choose Install app or Add to Home screen.');
      return;
    }
    btn.disabled = true;
    var prompt = deferredPrompt;
    try {
      prompt.prompt(); // must run inside this click handler (user gesture)
      var choice = await prompt.userChoice;
      deferredPrompt = null; // a prompt can only be used once
      if (choice && choice.outcome === 'accepted') {
        // Do not claim success here; the appinstalled event confirms the install.
        closeModal(false);
      } else {
        closeModal(true);
      }
    } catch (err) {
      deferredPrompt = null;
      showNote('Install could not start. Use your browser menu and choose Install app or Add to Home screen.');
    } finally {
      btn.disabled = false;
    }
  }

  function buildModal() {
    var el = document.createElement('div');
    el.id = 'pwa-modal';
    el.className = 'pwa-modal';
    el.setAttribute('hidden', '');
    el.innerHTML =
      '<div class="pwa-backdrop" data-pwa-close></div>' +
      '<div class="pwa-dialog glass" role="dialog" aria-modal="true" aria-labelledby="pwa-title" aria-describedby="pwa-subtitle">' +
        '<button type="button" class="pwa-close" id="pwa-close" aria-label="Close install dialog" data-pwa-close>&times;</button>' +
        '<span class="brand-mark pwa-mark" aria-hidden="true">A</span>' +
        '<h2 id="pwa-title">Install AttendWise</h2>' +
        '<p id="pwa-subtitle" class="pwa-sub">Your attendance planner, right on your home screen.</p>' +
        '<ul class="pwa-benefits">' +
          '<li>Quick access from your home screen</li>' +
          '<li>App-like experience without browser UI</li>' +
          '<li>Faster access to attendance planning</li>' +
          '<li>Offline access to cached resources</li>' +
        '</ul>' +
        '<div id="pwa-install" class="pwa-actions">' +
          '<button type="button" class="btn btn-primary" id="pwa-install-btn">Install App</button>' +
          '<button type="button" class="btn btn-secondary" id="pwa-later" data-pwa-close>Maybe Later</button>' +
        '</div>' +
        '<div id="pwa-ios" class="pwa-ios" hidden>' +
          '<p>On iPhone or iPad: tap the Share button, then choose Add to Home Screen.</p>' +
          '<button type="button" class="btn btn-secondary" id="pwa-close-ios" data-pwa-close>Got it</button>' +
        '</div>' +
        '<p id="pwa-note" class="pwa-note" role="status" hidden></p>' +
      '</div>';
    document.body.appendChild(el);
    return el;
  }

  function wire() {
    modal = buildModal();
    modal.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('[data-pwa-close]')) closeModal(true);
    });
    $('pwa-install-btn').addEventListener('click', onInstallClick);
    document.addEventListener('keydown', onKeydown);
  }

  function maybeShowNative() {
    if (!modal || !deferredPrompt || isStandalone() || sessionDismissed()) return;
    openModal('native');
  }

  // Capture the event so prompt() can be called later from a user gesture.
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    deferredPrompt = ev;
    if (modal) maybeShowNative(); // event fired after boot
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    closeModal(false);
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  });

  function boot() {
    wire();
    if (isStandalone()) return;
    if (deferredPrompt) {
      maybeShowNative();
    } else if (isIOSSafari() && !sessionDismissed()) {
      // iOS has no install prompt; show the manual Share steps once per session.
      setTimeout(function () {
        if (!isStandalone() && !sessionDismissed()) openModal('ios');
      }, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
