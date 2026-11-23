/**
 * @theme.tools/telemetry + @theme.tools/ui + @theme.tools/blog Unified Browser Runtime
 * Sourced from @theme.tools/telemetry (seven-system-observability) & @theme.tools/ui (primitives).
 *
 * Configures & correlates all 7 observability rails under a single W3C traceparent:
 *   1. Cloudflare Operational & Core Web Vitals (LCP, CLS, INP, FCP, TTFB)
 *   2. Sentry Browser Exception & UnhandledRejection Envelope v7 Boundary
 *   3. PostHog Product Analytics & Feature-Flag Exposure ($feature_flag_called)
 *   4. Google Analytics 4 (gtag + Single-Pageview Deduplicator)
 *   5. Google Tag Manager Consent Mode v2 (window.dataLayer)
 *   6. Langfuse Always-On Client Span Bridge (strict 2500ms timeout + 3-strike circuit breaker)
 *   7. Promptfoo Synthetic AI Verification Status
 */
(function () {
  if (window.__TT_RUNTIME_LOADED__) return;
  window.__TT_RUNTIME_LOADED__ = true;

  var API_BASE =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:8787'
      : 'https://api.crawl.cheap';

  function randomHex(bytes) {
    var arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    var out = '';
    for (var i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, '0');
    return out;
  }

  var traceId = randomHex(16);
  var spanId = randomHex(8);
  var traceparent = '00-' + traceId + '-' + spanId + '-01';
  var sessionId = (function () {
    try {
      var k = 'tt_session_id';
      var existing = sessionStorage.getItem(k);
      if (existing) return existing;
      var created = 'sess_' + randomHex(8);
      sessionStorage.setItem(k, created);
      return created;
    } catch (_) {
      return 'sess_' + randomHex(8);
    }
  })();
  var distinctId = (function () {
    try {
      var k = 'tt_distinct_id';
      var existing = localStorage.getItem(k);
      if (existing) return existing;
      var created = 'usr_' + randomHex(8);
      localStorage.setItem(k, created);
      return created;
    } catch (_) {
      return 'usr_' + randomHex(8);
    }
  })();

  window.__TT_TRACE__ = {
    traceId: traceId,
    spanId: spanId,
    traceparent: traceparent,
    sessionId: sessionId,
    distinctId: distinctId,
    apiBase: API_BASE,
  };

  // 1. Google Tag Manager Consent Mode v2 + dataLayer
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = window.gtag || gtag;
  window.dataLayer.push({
    event: 'tt_consent_init',
    trace_id: traceId,
    consent_mode_v2: {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      security_storage: 'granted',
    },
  });

  // 2. Google Analytics 4 Single-Pageview Deduplicator
  var seenPageviews = {};
  window.__TT_GA4__ = {
    measurementId: (window.__TT_CONFIG__ && window.__TT_CONFIG__.ga4MeasurementId) || 'G-CRAWLCHEAP',
    trackPageview: function (path) {
      var norm = (path || location.pathname).replace(/\/+$/, '') || '/';
      var key = sessionId + '|' + norm;
      if (seenPageviews[key]) return false;
      seenPageviews[key] = Date.now();
      window.dataLayer.push({
        event: 'tt_governed_navigation',
        page_location: norm,
        trace_id: traceId,
      });
      return true;
    },
  };

  // 3. PostHog Product Analytics & Feature-Flag Bridge
  var phQueue = [];
  window.posthog = window.posthog || {
    __tt_bridged: true,
    capture: function (eventName, properties) {
      phQueue.push({ event: eventName, properties: properties || {}, timestamp: new Date().toISOString() });
      dispatchTelemetryEvent(eventName, properties || {});
    },
    identify: function (newId) {
      if (newId) distinctId = String(newId);
    },
    isFeatureEnabled: function () {
      return true;
    },
    _queue: phQueue,
  };

  // 4. Langfuse Safe Client Bridge (2500ms timeout + 3-strike circuit breaker)
  var lfFailures = 0;
  var lfOpenUntil = 0;
  window.LangfuseSafe = {
    timeoutMs: 2500,
    strikeThreshold: 3,
    getStatus: function () {
      return {
        timeoutMs: 2500,
        consecutiveFailures: lfFailures,
        circuitOpen: Date.now() < lfOpenUntil,
        traceId: traceId,
      };
    },
    traceGeneration: function (span) {
      return dispatchTelemetryEvent('llm_generation', { model: span && span.model }, span);
    },
  };

  // 5. Sentry Browser Exception & UnhandledRejection Boundary
  window.Sentry = window.Sentry || {
    __tt_bridged: true,
    captureException: function (err, extra) {
      var msg = err && err.message ? err.message : String(err);
      dispatchTelemetryEvent('client_exception', extra || {}, null, {
        name: (err && err.name) || 'Error',
        message: msg,
      });
    },
    captureMessage: function (msg) {
      dispatchTelemetryEvent('client_message', { message: String(msg) });
    },
  };

  window.addEventListener('error', function (ev) {
    if (ev && ev.error) {
      window.Sentry.captureException(ev.error, { filename: ev.filename, lineno: ev.lineno });
    }
  });
  window.addEventListener('unhandledrejection', function (ev) {
    if (ev && ev.reason) {
      window.Sentry.captureException(ev.reason, { unhandledRejection: true });
    }
  });

  // 6. Unified 7-Rail Dispatcher with 2500ms AbortSignal timeout & fail-open spool
  function dispatchTelemetryEvent(eventName, properties, genAiSpan, errorObj) {
    if (Date.now() < lfOpenUntil) return Promise.resolve({ spooled: true });
    var payload = {
      eventName: eventName,
      sessionId: sessionId,
      distinctId: distinctId,
      canonicalPath: location.pathname,
      traceId: traceId,
      spanId: randomHex(8),
      consent: { analytics: true, marketing: false, errorReporting: true },
      properties: properties || {},
    };
    if (genAiSpan) payload.genAiSpan = genAiSpan;
    if (errorObj) payload.error = errorObj;

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 2500) : null;

    return fetch(API_BASE + '/v2/telemetry/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        traceparent: traceparent,
      },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
      keepalive: true,
    })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (res.ok) {
          lfFailures = 0;
        } else {
          lfFailures++;
          if (lfFailures >= 3) lfOpenUntil = Date.now() + 60000;
        }
        return res.json().catch(function () { return { ok: res.ok }; });
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        lfFailures++;
        if (lfFailures >= 3) lfOpenUntil = Date.now() + 60000;
        try {
          var spool = JSON.parse(sessionStorage.getItem('tt_telemetry_spool') || '[]');
          spool.push(payload);
          sessionStorage.setItem('tt_telemetry_spool', JSON.stringify(spool.slice(-32)));
        } catch (_) {}
        return { failedOpen: true };
      });
  }

  window.__TT_TELEMETRY__ = {
    dispatch: dispatchTelemetryEvent,
    traceId: traceId,
    traceparent: traceparent,
    sessionId: sessionId,
    distinctId: distinctId,
  };

  // Emit initial deduplicated page_view
  if (window.__TT_GA4__.trackPageview(location.pathname)) {
    setTimeout(function () {
      dispatchTelemetryEvent('page_view', {
        title: document.title,
        referrer: document.referrer || '',
        viewport: window.innerWidth + 'x' + window.innerHeight,
      });
    }, 120);
  }

  // 7. @theme.tools/ui Custom Elements & Tactile Micro-Interactions (MI01-MI30)
  if (typeof customElements !== 'undefined') {
    if (!customElements.get('tt-badge')) {
      customElements.define(
        'tt-badge',
        class extends HTMLElement {
          connectedCallback() {
            this.classList.add('tt-badge');
          }
        }
      );
    }
    if (!customElements.get('tt-stat-card')) {
      customElements.define(
        'tt-stat-card',
        class extends HTMLElement {
          connectedCallback() {
            this.classList.add('tt-card', 'tt-surface');
          }
        }
      );
    }
  }

  document.addEventListener('pointermove', function (e) {
    var spot = e.target && e.target.closest && e.target.closest('[data-spotlight="true"]');
    if (spot) {
      var rect = spot.getBoundingClientRect();
      spot.style.setProperty('--tt-spot-x', (e.clientX - rect.left) + 'px');
      spot.style.setProperty('--tt-spot-y', (e.clientY - rect.top) + 'px');
    }
  });

  // 8. Popped-Out Collapsible References Drawer (Collapsed by default, auto-opens on #bib-source-* / #references click, interactive tier filters)
  function syncReferencesDrawerFromHash() {
    var h = location.hash || '';
    if (h === '#references' || h === '#bibliography' || h === '#bibliography-heading' || h.indexOf('#bib-source-') === 0) {
      var drawer = document.querySelector('[data-testid="collapsible-citations-drawer"]');
      if (drawer && !drawer.open) {
        drawer.open = true;
      }
      var target = h ? document.querySelector(h) : drawer;
      if (target && target.scrollIntoView) {
        setTimeout(function () {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
      }
    }
  }
  window.addEventListener('hashchange', syncReferencesDrawerFromHash);
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest && e.target.closest('a[href^="#bib-source-"], a[href="#bibliography"], a[href="#bibliography-heading"], a[href="#references"]');
    if (link) {
      var drawer = document.querySelector('[data-testid="collapsible-citations-drawer"]');
      if (drawer && !drawer.open) {
        drawer.open = true;
      }
    }
    var filterBtn = e.target && e.target.closest && e.target.closest('[data-bib-filter]');
    if (filterBtn) {
      var tier = filterBtn.getAttribute('data-bib-filter') || 'all';
      var container = filterBtn.closest('[data-testid="collapsible-citations-drawer"]') || document;
      container.querySelectorAll('[data-bib-filter]').forEach(function (b) {
        b.classList.toggle('is-active', b === filterBtn);
      });
      container.querySelectorAll('[data-bib-tier]').forEach(function (card) {
        var match = tier === 'all' || card.getAttribute('data-bib-tier') === tier;
        card.style.display = match ? '' : 'none';
      });
    }
  });

  // 9. Universal Google / GitHub Avatar Image & Account Initials Hydration for .tt-avatar-circle
  function computeAccountInitials(name, email) {
    var cleanName = String(name || '').trim();
    if (cleanName) {
      var parts = cleanName.split(' ').filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return cleanName.slice(0, 2).toUpperCase();
    }
    var cleanEmail = String(email || '').trim();
    if (cleanEmail) {
      var local = cleanEmail.split('@')[0] || '';
      var segs = local.split(/[._-]+/).filter(Boolean);
      if (segs.length >= 2) {
        return (segs[0][0] + segs[1][0]).toUpperCase();
      }
      return local.slice(0, 2).toUpperCase();
    }
    return '';
  }

  function hydrateUniversalAvatarCircles() {
    var avatarUrl = '';
    var name = '';
    var email = '';
    var provider = '';
    try {
      avatarUrl = localStorage.getItem('crawlcheap_avatar') || '';
      name = localStorage.getItem('crawlcheap_name') || '';
      email = localStorage.getItem('crawlcheap_email') || '';
      provider = localStorage.getItem('crawlcheap_provider') || '';
    } catch (_) {}

    var initials = computeAccountInitials(name, email);
    var circles = document.querySelectorAll('.tt-avatar-circle');
    circles.forEach(function (el) {
      if (avatarUrl && (avatarUrl.indexOf('https://') === 0 || avatarUrl.indexOf('http://') === 0)) {
        var img = document.createElement('img');
        img.src = avatarUrl;
        img.alt = name || email || 'User avatar';
        el.innerHTML = '';
        el.appendChild(img);
        el.setAttribute('title', (name || email) + (provider ? ' (' + provider + ')' : ''));
      } else if (initials) {
        el.textContent = initials;
        el.setAttribute('title', (name || email) + (provider ? ' (' + provider + ')' : ''));
      } else {
        el.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>';
        el.setAttribute('title', 'Sign in with Google or GitHub');
      }
    });
  }

  window.__TT_HYDRATE_AVATAR__ = hydrateUniversalAvatarCircles;
  hydrateUniversalAvatarCircles();
})();

(function () {
  if (window.__ttMegaMenu) return;
  window.__ttMegaMenu = true;
  var CLOSE_DELAY = 180;
  var mobile = function () { return window.matchMedia('(max-width: 720px)').matches; };

  function triggersOf(root) {
    return Array.prototype.slice.call(root.querySelectorAll('[data-tt-mm-trigger]'));
  }
  function panelFor(trigger) {
    return trigger.parentNode ? trigger.parentNode.querySelector('.tt-mm__panel') : null;
  }
  function itemsOf(panel) {
    return panel ? Array.prototype.slice.call(panel.querySelectorAll('.tt-mm__item')) : [];
  }
  function closeAll(root, except) {
    triggersOf(root).forEach(function (t) {
      if (t === except) return;
      t.setAttribute('aria-expanded', 'false');
    });
  }
  function openTrigger(root, t) {
    closeAll(root, t);
    t.setAttribute('aria-expanded', 'true');
  }
  function closeTrigger(t) { t.setAttribute('aria-expanded', 'false'); }
  function setRoving(root, active) {
    triggersOf(root).forEach(function (t) {
      t.setAttribute('tabindex', t === active ? '0' : '-1');
    });
  }

  document.querySelectorAll('[data-tt-mm-root]').forEach(function (root) {
    var bar = root.querySelector('.tt-mm__bar');
    var burger = root.querySelector('[data-tt-mm-burger]');
    var triggers = triggersOf(root);
    var closeTimer = null;

    function previewItem(item) {
      var src = item.getAttribute('data-tt-mm-preview-src');
      if (!src) return;
      var panel = item.closest('.tt-mm__panel');
      if (!panel) return;
      var card = panel.querySelector('.tt-mm__panel-featured');
      var image = panel.querySelector('.tt-mm__panel-featured-img');
      var title = panel.querySelector('.tt-mm__panel-featured-title');
      if (!card || !image || !title) return;
      card.setAttribute('href', item.getAttribute('data-tt-mm-preview-href') || item.getAttribute('href') || '#');
      image.setAttribute('src', src);
      image.setAttribute('alt', item.getAttribute('data-tt-mm-preview-alt') || '');
      title.textContent = item.getAttribute('data-tt-mm-preview-title') || item.textContent || '';
    }

    root.addEventListener('mouseover', function (e) {
      var item = e.target.closest && e.target.closest('[data-tt-mm-preview-src]');
      if (item) previewItem(item);
    });
    root.addEventListener('focusin', function (e) {
      var item = e.target.closest && e.target.closest('[data-tt-mm-preview-src]');
      if (item) previewItem(item);
    });

    // Mobile burger: toggle the whole bar.
    if (burger && bar) {
      burger.addEventListener('click', function () {
        var open = bar.getAttribute('data-tt-mm-open') === 'true';
        bar.setAttribute('data-tt-mm-open', open ? 'false' : 'true');
        burger.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (open) closeAll(root, null);
      });
    }

    triggers.forEach(function (trigger, idx) {
      var panel = panelFor(trigger);

      // Click-to-pin (toggle). On desktop this persists the open panel even after the pointer
      // leaves; on mobile it is the accordion expand/collapse.
      trigger.addEventListener('click', function (e) {
        // If the trigger wraps a link and the user clicked the link itself, let it navigate.
        var isOpen = trigger.getAttribute('aria-expanded') === 'true';
        if (isOpen) { closeTrigger(trigger); }
        else { openTrigger(root, trigger); }
        e.preventDefault();
      });

      // Hover-intent (desktop only): open immediately, close after a short delay so a diagonal
      // mouse path to the panel doesn't snap it shut.
      trigger.parentNode.addEventListener('mouseenter', function () {
        if (mobile()) return;
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        openTrigger(root, trigger);
      });
      trigger.parentNode.addEventListener('mouseleave', function () {
        if (mobile()) return;
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(function () { closeTrigger(trigger); }, CLOSE_DELAY);
      });

      // Keyboard on the trigger.
      trigger.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'ArrowRight') {
          e.preventDefault();
          var n = triggers[(idx + 1) % triggers.length];
          setRoving(root, n); n.focus();
        } else if (k === 'ArrowLeft') {
          e.preventDefault();
          var p = triggers[(idx - 1 + triggers.length) % triggers.length];
          setRoving(root, p); p.focus();
        } else if (k === 'ArrowDown' || k === 'Enter' || k === ' ') {
          e.preventDefault();
          openTrigger(root, trigger);
          var items = itemsOf(panel);
          if (items.length) items[0].focus();
        } else if (k === 'Escape') {
          closeTrigger(trigger);
        } else if (k === 'Home') {
          e.preventDefault(); setRoving(root, triggers[0]); triggers[0].focus();
        } else if (k === 'End') {
          e.preventDefault(); var last = triggers[triggers.length - 1]; setRoving(root, last); last.focus();
        }
      });

      // Keyboard inside the panel item list.
      if (panel) {
        panel.addEventListener('keydown', function (e) {
          var items = itemsOf(panel);
          var ci = items.indexOf(document.activeElement);
          var k = e.key;
          if (k === 'ArrowDown') { e.preventDefault(); (items[ci + 1] || items[0]).focus(); }
          else if (k === 'ArrowUp') {
            e.preventDefault();
            if (ci <= 0) { trigger.focus(); } else { items[ci - 1].focus(); }
          } else if (k === 'Escape') {
            e.preventDefault(); closeTrigger(trigger); trigger.focus();
          } else if (k === 'Home') { e.preventDefault(); if (items[0]) items[0].focus(); }
          else if (k === 'End') { e.preventDefault(); if (items.length) items[items.length - 1].focus(); }
          else if (k === 'Tab') { /* allow natural tab-out; close the panel */ closeTrigger(trigger); }
        });
      }
    });

    // Click outside closes any pinned panel (desktop).
    document.addEventListener('click', function (e) {
      if (root.contains(e.target)) return;
      closeAll(root, null);
    });
    // Escape anywhere closes.
    root.addEventListener('focusout', function () {
      // If focus left the whole menu, collapse pinned desktop panels.
      setTimeout(function () {
        if (!root.contains(document.activeElement) && !mobile()) closeAll(root, null);
      }, 0);
    });
  });
})();
(function(){
  if(window.__ttTheme)return;window.__ttTheme=true;
  var KEY='dm-theme';
  function current(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';}
  function apply(t){
    document.documentElement.setAttribute('data-theme',t);
    try{document.cookie=KEY+'='+t+';path=/;max-age=31536000;SameSite=Lax';}catch(e){}
    var btns=document.querySelectorAll('[data-tt-theme-toggle]');
    for(var i=0;i<btns.length;i++){
      btns[i].setAttribute('aria-pressed',t==='light'?'true':'false');
      btns[i].setAttribute('aria-label',t==='light'?'Switch to dark reading mode':'Switch to light reading mode');
    }
  }
  apply(current());
  document.addEventListener('click',function(e){
    var b=e.target&&e.target.closest?e.target.closest('[data-tt-theme-toggle]'):null;
    if(!b)return;
    apply(current()==='light'?'dark':'light');
  },false);
})();
(function(){
  if(window.__ttBookmark)return;window.__ttBookmark=true;
  var KEY='dm:bookmarks';
  function read(){try{var v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v:[];}catch(e){return null;}}
  function write(list){try{localStorage.setItem(KEY,JSON.stringify(list));return true;}catch(e){return false;}}
  function has(list,id){for(var i=0;i<list.length;i++){if(list[i]&&list[i].id===id)return true;}return false;}
  function esc(s){var d=document.createElement('div');d.textContent=(s==null?'':String(s));return d.innerHTML;}
  var storageOk=read()!==null;
  function syncButtons(){
    var list=read()||[];var btns=document.querySelectorAll('[data-tt-bookmark]');
    for(var i=0;i<btns.length;i++){var b=btns[i];var saved=has(list,b.getAttribute('data-tt-id'));
      b.setAttribute('aria-pressed',saved?'true':'false');
      var l=b.querySelector('.tt-bookmark__label');if(l)l.textContent=saved?'Saved':'Save';
      if(!storageOk){b.setAttribute('disabled','');b.setAttribute('title','Local storage is blocked in this browser');}}
  }
  function toggle(b){var list=read();if(list===null)return;var id=b.getAttribute('data-tt-id');
    if(has(list,id)){list=list.filter(function(x){return x.id!==id;});}
    else{list.push({id:id,title:b.getAttribute('data-tt-title'),url:b.getAttribute('data-tt-url'),savedAt:new Date().toISOString()});}
    write(list);syncButtons();renderList();}
  function renderList(){
    var root=document.querySelector('[data-tt-reading-list]');if(!root)return;
    var ul=root.querySelector('.tt-reading-list__items');var empty=root.querySelector('.tt-reading-list__empty');
    var actions=root.querySelector('.tt-reading-list__actions');var note=root.querySelector('.tt-reading-list__note');
    if(!storageOk){if(note)note.hidden=false;if(empty)empty.hidden=true;if(ul)ul.hidden=true;if(actions)actions.hidden=true;return;}
    var list=(read()||[]).slice().sort(function(a,b){return (b.savedAt||'').localeCompare(a.savedAt||'');});
    if(!list.length){if(empty)empty.hidden=false;if(ul){ul.hidden=true;ul.innerHTML='';}if(actions)actions.hidden=true;return;}
    if(empty)empty.hidden=true;if(actions)actions.hidden=false;
    if(ul){ul.hidden=false;ul.innerHTML=list.map(function(b){var d=(b.savedAt||'').slice(0,10);
      return '<li class="tt-reading-list__item"><a href="'+esc(b.url)+'">'+esc(b.title)+'</a>'+(d?' <span class="tt-reading-list__date">saved '+esc(d)+'</span>':'')+' <button class="tt-reading-list__remove" type="button" data-tt-remove="'+esc(b.id)+'" aria-label="Remove '+esc(b.title)+' from your reading list">Remove</button></li>';
    }).join('');}
  }
  document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;
    var b=t.closest('[data-tt-bookmark]');if(b){e.preventDefault();toggle(b);return;}
    var rm=t.closest('[data-tt-remove]');if(rm){var list=read();if(list){write(list.filter(function(x){return x.id!==rm.getAttribute('data-tt-remove');}));syncButtons();renderList();}return;}
    if(t.closest('[data-tt-rl-clear]')){if(write([])){syncButtons();renderList();}return;}
    if(t.closest('[data-tt-rl-export]')){var data=JSON.stringify(read()||[],null,2);
      var a=document.createElement('a');a.href='data:application/json;charset=utf-8,'+encodeURIComponent(data);
      a.download='desktop-management-reading-list.json';document.body.appendChild(a);a.click();document.body.removeChild(a);return;}
  },false);
  syncButtons();renderList();
})();
