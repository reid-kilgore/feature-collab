// Mini App page. Plain DOM, no dependencies. All text from the server is set with textContent,
// never as HTML.
(function () {
  'use strict';

  var tg = window.Telegram && window.Telegram.WebApp;
  var initData = tg && tg.initData ? tg.initData : '';
  var base = location.pathname.replace(/\/+$/, '');
  var app = document.getElementById('app');

  var state = {
    screen: 'list', // list | set
    list: null,
    detail: null,
    answers: Object.create(null), // questionId -> { selected: [], other: '', text: '', skip: false }
    results: Object.create(null), // questionId -> { status, reason }
    sending: false,
    error: null,
    menu: false, // the header "…" menu is open
    sheet: null, // the long-press sheet: { batch, confirm }
    confirmCancel: false, // the header menu is asking to confirm a cancel
    toast: null,
  };

  // The native header back button needs Bot API 6.1. Without it the page draws its own.
  var nativeBack = false;
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) { /* not fatal */ }
    try {
      nativeBack = !!(tg.BackButton && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1'));
      if (nativeBack) tg.BackButton.onClick(function () { goList(); });
    } catch (e) { nativeBack = false; }
  }

  function syncBackButton() {
    if (!nativeBack) return;
    try { if (state.screen === 'set') tg.BackButton.show(); else tg.BackButton.hide(); } catch (e) { /* ignore */ }
  }

  function haptic(kind) {
    try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(kind); } catch (e) { /* ignore */ }
  }

  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (key) {
      var value = props[key];
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') el.textContent = value;
      else if (key === 'class') el.className = value;
      else if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), value);
      else if (key === 'value') el.value = value;
      else if (key === 'checked' || key === 'disabled') el[key] = !!value;
      else el.setAttribute(key, value === true ? '' : value);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid === undefined || kid === null || kid === false) continue;
      el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return el;
  }

  // Builds DOM from the server's Markdown nodes with createElement and textContent only, never from HTML.
  // A link opens through Telegram's openLink when the page runs inside Telegram, else as a normal link.
  var SAFE_HREF = /^https?:\/\/[^\s"'<>`]+$/;
  function mdNodes(nodes, fallback) {
    var frag = [];
    if (!nodes || !nodes.length) return fallback ? [document.createTextNode(fallback)] : frag;
    nodes.forEach(function (n) {
      if (!n) return;
      if (n.t === 'text') { frag.push(document.createTextNode(String(n.v))); return; }
      var kids = mdNodes(n.c, '');
      var el = null;
      if (n.t === 'b') el = h('strong');
      else if (n.t === 'i') el = h('em');
      else if (n.t === 'code') el = h('code');
      else if (n.t === 'pre') el = h('pre');
      else if (n.t === 'a' && typeof n.href === 'string' && SAFE_HREF.test(n.href)) {
        var url = n.href;
        el = h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', onclick: function (e) {
          if (tg && typeof tg.openLink === 'function') { e.preventDefault(); try { tg.openLink(url); } catch (x) { /* falls back to the link */ } }
        } });
      }
      if (!el) { kids.forEach(function (k) { frag.push(k); }); return; }
      kids.forEach(function (k) { el.appendChild(k); });
      frag.push(el);
    });
    return frag;
  }

  function api(path, options) {
    options = options || {};
    var headers = { 'x-telegram-init-data': initData };
    if (options.body) headers['content-type'] = 'application/json';
    return fetch(base + '/api/' + path, { method: options.method || 'GET', headers: headers, body: options.body, cache: 'no-store' })
      .then(function (res) {
        if (res.status === 401) { var e = new Error('auth'); e.auth = true; throw e; }
        return res.json().then(function (body) { return { status: res.status, body: body }; });
      });
  }

  function fail(error) {
    state.error = error && error.auth
      ? 'This page has expired, or was not opened from the bot. Close it and send /open to the bot to reopen it. Your unsent answers are kept.'
      : 'Could not reach the bot. Check the connection and try again.';
    render();
  }

  function time(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function ago(iso) {
    var minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + 'h ago';
    return Math.round(hours / 24) + 'd ago';
  }

  function deadline(iso) {
    if (!iso) return null;
    var minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (minutes <= 0) return 'Due now';
    if (minutes < 60) return 'Due in ' + minutes + 'm';
    return 'Due ' + time(iso);
  }

  // ---- navigation ----

  function goList() {
    state.menu = false;
    state.screen = 'list';
    state.detail = null;
    state.error = null;
    loadList();
  }

  function loadList() {
    api('batches').then(function (r) {
      state.list = r.body;
      state.error = null;
      render();
    }, fail);
  }

  function openSet(id) {
    state.menu = false;
    state.confirmCancel = false;
    state.answers = loadDraft(id);
    state.results = Object.create(null);
    api('batches/' + id).then(function (r) {
      if (r.status === 404) { goList(); return; }
      state.detail = r.body;
      state.screen = 'set';
      state.error = null;
      render();
    }, fail);
  }

  // ---- answers ----

  // Drafts survive a reload or an expired session. Keys are question ids, so the copies are
  // made on prototype-less objects.
  function draftKey(id) { return 'draft:' + id; }

  // Stored as [id, answer] pairs, so an id like "__proto__" is just data.
  function loadDraft(id) {
    var out = Object.create(null);
    try {
      var saved = JSON.parse(sessionStorage.getItem(draftKey(id)) || '[]');
      if (Array.isArray(saved)) {
        saved.forEach(function (pair) {
          var a = pair && pair[1];
          if (typeof pair[0] === 'string' && a && Array.isArray(a.selected)) {
            out[pair[0]] = { selected: a.selected.map(String), other: String(a.other || ''), text: String(a.text || ''), skip: !!a.skip };
          }
        });
      }
    } catch (e) { /* storage may be unavailable */ }
    return out;
  }

  function saveDraft() {
    if (!state.detail) return;
    try {
      sessionStorage.setItem(draftKey(state.detail.id), JSON.stringify(Object.keys(state.answers).map(function (k) { return [k, state.answers[k]]; })));
    } catch (e) { /* storage may be unavailable */ }
  }

  function clearDraft(id) {
    try { sessionStorage.removeItem(draftKey(id)); } catch (e) { /* ignore */ }
  }

  function answerFor(q) {
    var a = state.answers[q.id];
    if (!a) {
      a = { selected: q.preselected ? q.preselected.slice() : [], other: '', text: '', skip: false };
      state.answers[q.id] = a;
    }
    return a;
  }

  function isAnswered(q) {
    var a = answerFor(q);
    if (a.skip) return true;
    if (q.type === 'text') return a.text.trim().length > 0;
    return a.selected.length > 0 || a.other.trim().length > 0;
  }

  function openQuestions() {
    return state.detail.questions.filter(function (q) { return q.state === 'open'; });
  }

  function buildSubmission() {
    var out = [];
    openQuestions().forEach(function (q) {
      if (!isAnswered(q)) return;
      var a = answerFor(q);
      if (a.skip) { out.push({ questionId: q.id, skip: true }); return; }
      if (q.type === 'text') { out.push({ questionId: q.id, text: a.text.trim() }); return; }
      var item = { questionId: q.id, selected: a.selected.slice() };
      if (a.other.trim()) item.other = a.other.trim();
      out.push(item);
    });
    return out;
  }

  function send() {
    var answers = buildSubmission();
    if (!answers.length || state.sending) return;
    state.sending = true;
    render();
    var batchId = state.detail.id;
    api('batches/' + batchId + '/answers', { method: 'POST', body: JSON.stringify({ answers: answers }) }).then(function (r) {
      state.sending = false;
      if (r.status !== 200) { state.error = 'The bot could not take that submission. Try again.'; render(); return; }
      var outcome = r.body;
      state.results = Object.create(null);
      outcome.results.forEach(function (res) { state.results[res.questionId] = res; });
      // Keep only the answers that did not go through, so they can be corrected and sent again.
      Object.keys(state.results).forEach(function (id) { if (state.results[id].status === 'ok') delete state.answers[id]; });
      saveDraft();
      var sent = outcome.results.filter(function (x) { return x.status === 'ok'; }).length;
      var failed = outcome.results.filter(function (x) { return x.status !== 'ok'; });
      var sentText = 'Sent ' + sent + (sent === 1 ? ' answer' : ' answers');
      if (!failed.length) {
        haptic('success');
        goList();
        showToast(sentText);
        return;
      }
      haptic('warning');
      var mixed = (sent ? sentText + '. ' : '') + failed.length + ' not sent: ' + (failed[0].reason || 'it could not be applied.');
      return api('batches/' + batchId).then(function (d) {
        if (d.status === 404) {
          // The set closed under us (cancelled, expired, or finished in chat): nothing to stay on.
          clearDraft(batchId);
          goList();
        } else {
          state.detail = d.body;
          render();
        }
        showToast(mixed, 7000);
      });
    }).catch(function (error) { state.sending = false; fail(error); });
  }

  // ---- moving to chat, cancelling, copying ----

  // The toast belongs to no screen, so it survives the navigation that follows a failure.
  function showToast(text, ms) {
    state.toast = text;
    render();
    setTimeout(function () { if (state.toast === text) { state.toast = null; render(); } }, ms || 2500);
  }

  // Reposts the open question (or one question) in the chat, then closes the app so the chat shows.
  function openInChat(batchId, questionId) {
    state.menu = false;
    state.sheet = null;
    var body = questionId === undefined ? {} : { questionId: questionId };
    api('batches/' + batchId + '/chat', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
      if (r.status === 200 && r.body.status === 'ok') {
        if (tg) { try { tg.close(); return; } catch (e) { /* fall through */ } }
        showToast('Opened in chat.');
        return;
      }
      if (state.screen === 'set') openSet(batchId); else loadList();
      showToast(r.status === 200 && r.body.reason ? r.body.reason : 'Could not move this to the chat.', 6000);
    }, fail);
  }

  function cancelSet(batchId) {
    state.menu = false;
    state.confirmCancel = false;
    state.sheet = null;
    api('batches/' + batchId + '/cancel', { method: 'POST', body: JSON.stringify({ confirm: true }) }).then(function (r) {
      if (r.status === 200 && r.body.status === 'ok') { clearDraft(batchId); state.screen = 'list'; state.detail = null; loadList(); showToast('Set cancelled.'); return; }
      goList();
      showToast(r.status === 200 && r.body.reason ? r.body.reason : 'Could not cancel this set.', 6000);
    }, fail);
  }

  function copyText(text) {
    state.menu = false;
    var done = function () { showToast('Copied.'); };
    var fallback = function () {
      var box = h('textarea', { 'aria-hidden': 'true' });
      box.value = text;
      document.body.appendChild(box);
      box.select();
      try { document.execCommand('copy'); done(); } catch (e) { showToast('Could not copy.'); }
      document.body.removeChild(box);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  // ---- rendering ----

  function renderList() {
    var nodes = [];
    nodes.push(h('h1', { text: 'Open questions' }));
    if (!state.list) { nodes.push(h('p', { class: 'hint', text: 'Loading…' })); return nodes; }
    nodes.push(h('p', { class: 'hint', text: 'Read at ' + time(state.list.readAt) }));
    if (!state.list.batches.length) {
      nodes.push(h('div', { class: 'empty' }, h('p', { text: 'Nothing is waiting for you.' })));
      return nodes;
    }
    state.list.batches.forEach(function (b) {
      var due = deadline(b.timeoutAt);
      var bar = h('div', { class: 'bar' }, h('div'));
      bar.firstChild.style.width = (b.total ? Math.round(100 * b.done / b.total) : 0) + '%';
      var card = h('button', { class: 'card', oncontextmenu: function (e) { e.preventDefault(); } },
        h('h2', { text: b.title }),
        h('div', { class: 'meta hint' },
          h('span', { text: b.asker }),
          h('span', { text: b.done + ' of ' + b.total + ' answered' }),
          h('span', { text: ago(b.createdAt) }),
          due ? h('span', { text: due }) : null),
        bar);
      onLongPress(card, function () { state.sheet = { batch: b, confirm: false }; render(); }, function () { openSet(b.id); });
      nodes.push(card);
    });
    return nodes;
  }

  // Calls onLong after a half second hold (touch or mouse), or onTap for a short press. A move or
  // scroll cancels both, so scrolling the list never opens a card.
  function onLongPress(el, onLong, onTap) {
    var timer = null;
    var fired = false;
    var startX = 0;
    var startY = 0;
    var cancel = function () { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('pointerdown', function (e) {
      fired = false;
      startX = e.clientX;
      startY = e.clientY;
      cancel();
      timer = setTimeout(function () { timer = null; fired = true; try { if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium'); } catch (x) { /* ignore */ } onLong(); }, 500);
    });
    el.addEventListener('pointermove', function (e) {
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) cancel();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (name) { el.addEventListener(name, cancel); });
    el.addEventListener('click', function (e) {
      if (fired) { fired = false; e.preventDefault(); return; }
      onTap();
    });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); if (!fired) { cancel(); fired = true; onLong(); } });
  }

  // A field plus a Done button that shows only while the field has focus (iOS has no Done bar
  // in Telegram's web view).
  function fieldWithDone(field) {
    return h('div', { class: 'field' }, field,
      h('button', { class: 'link done', text: 'Done', onpointerdown: function (e) { e.preventDefault(); }, onclick: dismissKeyboard }));
  }

  function isTextField(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'radio' && el.type !== 'checkbox';
  }

  function dismissKeyboard() {
    var el = document.activeElement;
    if (isTextField(el)) el.blur();
  }

  var focusedAt = 0;
  document.addEventListener('focusin', function (e) {
    if (!isTextField(e.target)) return;
    focusedAt = Date.now();
    document.body.className = 'typing';
  });
  document.addEventListener('focusout', function () { document.body.className = ''; });
  // A tap anywhere that is not a field, or a drag on the page, puts the keyboard away. The
  // drag is ignored for a moment after focus, because the browser scrolls the field into view.
  document.addEventListener('pointerdown', function (e) {
    if (!isTextField(e.target) && !(e.target.className === 'link done')) dismissKeyboard();
  });
  document.addEventListener('touchmove', function (e) {
    if (isTextField(e.target) || Date.now() - focusedAt < 400) return;
    dismissKeyboard();
  }, { passive: true });

  function optionNode(q, opt, a, rerender) {
    var multiple = q.type === 'multiple';
    var checked = a.selected.indexOf(opt.value) !== -1;
    var input = h('input', {
      type: multiple ? 'checkbox' : 'radio',
      name: 'q-' + q.id,
      checked: checked,
      onchange: function () {
        if (multiple) {
          var at = a.selected.indexOf(opt.value);
          if (at === -1) a.selected.push(opt.value); else a.selected.splice(at, 1);
        } else {
          a.selected = [opt.value];
          a.other = '';
        }
        a.skip = false;
        rerender();
      },
    });
    return h('label', { class: 'option' + (checked ? ' selected' : '') },
      input,
      h('span', { class: 'label' },
        opt.label,
        opt.recommended ? h('span', { class: 'tag', text: 'RECOMMENDED' }) : null,
        opt.description ? h.apply(null, ['span', { class: 'desc' }].concat(mdNodes(opt.descriptionNodes, opt.description))) : null));
  }

  function resultNote(q) {
    var r = state.results[q.id];
    if (!r || r.status === 'ok') return null;
    return h('div', { class: 'note error', text: r.reason || 'This answer was not sent.' });
  }

  function questionNode(q, index, total) {
    var card = h('section', { class: 'card' });
    var head = h('div', { class: 'row qhead' }, h('div', { class: 'qnum', text: 'Question ' + (index + 1) + ' of ' + total }));
    if (q.state === 'open') {
      head.appendChild(h('button', { class: 'link inchat', 'aria-label': 'Open this question in chat', text: 'In chat', onclick: function () { openInChat(state.detail.id, q.id); } }));
    }
    card.appendChild(head);
    card.appendChild(h.apply(null, ['p', { class: 'prompt' }].concat(mdNodes(q.promptNodes, q.prompt))));

    if (q.state !== 'open') {
      var text = q.state === 'answered' ? 'Answered: ' + (q.answerText || '') : q.state === 'skipped' ? 'Skipped' : 'Closed';
      card.appendChild(h('div', { class: 'settled', text: text }));
      var note = resultNote(q);
      if (note) card.appendChild(note);
      return card;
    }

    var a = answerFor(q);
    var body = h('div', { class: a.skip ? 'disabled' : '' });
    var rerender = function () { render(); };
    if (q.type === 'text') {
      // Multi-line: Return must add a new line, so it keeps the default key and the Done
      // button under the field is how the keyboard is dismissed.
      body.appendChild(fieldWithDone(h('textarea', {
        placeholder: q.placeholder || 'Your answer',
        value: a.text,
        oninput: function (e) { a.text = e.target.value; updateSendButton(); },
      })));
    } else {
      q.options.forEach(function (opt) { body.appendChild(optionNode(q, opt, a, rerender)); });
      if (q.allowOther) {
        body.appendChild(fieldWithDone(h('input', {
          type: 'text',
          enterkeyhint: 'done',
          placeholder: 'Other, or a note',
          value: a.other,
          oninput: function (e) {
            a.other = e.target.value;
            if (q.type === 'single' && a.other.trim()) { a.selected = []; refreshSelection(card); }
            updateSendButton();
          },
          onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
        })));
      }
    }
    card.appendChild(body);
    if (q.skippable) {
      card.appendChild(h('button', {
        class: 'link skip',
        text: a.skip ? 'Undo skip' : 'Skip this question',
        onclick: function () { a.skip = !a.skip; render(); },
      }));
    }
    var problem = resultNote(q);
    if (problem) card.appendChild(problem);
    return card;
  }

  // Unselects the radio cards when the user types their own answer to a single-choice question.
  function refreshSelection(card) {
    var inputs = card.querySelectorAll('input[type=radio]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].checked = false;
      inputs[i].parentNode.className = 'option';
    }
  }

  function sendLabel() {
    if (state.sending) return 'Sending…';
    var n = buildSubmission().length;
    return n === 1 ? 'Send 1 answer' : 'Send ' + n + ' answers';
  }

  function updateSendButton() {
    saveDraft();
    var button = document.getElementById('send');
    if (!button) return;
    button.textContent = sendLabel();
    button.disabled = state.sending || buildSubmission().length === 0;
  }

  function menuItem(label, hint, onclick, danger) {
    return h('button', { class: 'menu-item' + (danger ? ' danger' : ''), onclick: onclick },
      h('span', { text: label }),
      hint ? h('span', { class: 'hint', text: hint }) : null);
  }

  function setMenu(d) {
    if (state.confirmCancel) {
      return h('div', { class: 'menu', role: 'menu' },
        h('p', { class: 'menu-text', text: 'Cancel this set? The agent that asked gets a cancelled result.' }),
        menuItem('Yes, cancel the set', null, function () { cancelSet(d.id); }, true),
        menuItem('Keep it', null, function () { state.confirmCancel = false; render(); }));
    }
    return h('div', { class: 'menu', role: 'menu' },
      menuItem('Open in chat', 'The bot posts the open question again at the bottom of the chat', function () { openInChat(d.id); }),
      menuItem('Copy set title', null, function () { copyText(d.title); }),
      menuItem('Cancel this set', null, function () { state.confirmCancel = true; render(); }, true));
  }

  function renderSheet() {
    var b = state.sheet.batch;
    var items;
    if (state.sheet.confirm) {
      items = [
        h('p', { class: 'menu-text', text: 'Cancel "' + b.title + '"? The agent that asked gets a cancelled result.' }),
        menuItem('Yes, cancel the set', null, function () { cancelSet(b.id); }, true),
        menuItem('Keep it', null, function () { state.sheet.confirm = false; render(); }),
      ];
    } else {
      items = [
        menuItem('Answer here', null, function () { state.sheet = null; openSet(b.id); }),
        menuItem('Open in chat', 'Closes the app; the bot reposts the open question as a reply to the original', function () { openInChat(b.id); }),
        menuItem('Cancel this set', null, function () { state.sheet.confirm = true; render(); }, true),
      ];
    }
    return h('div', {},
      h('div', { class: 'scrim', onclick: function () { state.sheet = null; render(); } }),
      h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Actions for ' + b.title },
        h('div', { class: 'menu stacked' }, items),
        h('button', { class: 'menu-item close', text: 'Close', onclick: function () { state.sheet = null; render(); } })));
  }

  function renderSet() {
    var d = state.detail;
    var nodes = [];
    nodes.push(h('div', { class: 'row' },
      nativeBack ? h('span') : h('button', { class: 'link', text: '‹ Back', onclick: goList }),
      h('button', { class: 'dots', 'aria-label': 'More: open this set in chat, copy its title, or cancel it', 'aria-expanded': state.menu ? 'true' : 'false', text: '…', onclick: function () { state.menu = !state.menu; state.confirmCancel = false; render(); } })));
    if (state.menu) nodes.push(setMenu(d));
    nodes.push(h('h1', { text: d.title }));
    nodes.push(h('div', { class: 'hint', text: 'Asked by ' + d.asker + ' · ' + ago(d.createdAt) + ' · read at ' + time(d.readAt) }));
    if (d.message) nodes.push(h.apply(null, ['p', { class: 'message' }].concat(mdNodes(d.messageNodes, d.message))));
    d.questions.forEach(function (q, i) { nodes.push(questionNode(q, i, d.questions.length)); });
    var bar = h('div', { class: 'bottom' }, h('button', { id: 'send', class: 'send', onclick: send }));
    nodes.push(bar);
    return nodes;
  }

  function render() {
    var scroll = window.scrollY;
    app.textContent = '';
    if (state.error) {
      app.appendChild(h('div', { class: 'card' }, h('p', { class: 'note error', text: state.error })));
      if (state.screen === 'list' && !state.list) return;
    }
    var nodes = state.screen === 'set' && state.detail ? renderSet() : renderList();
    nodes.forEach(function (n) { app.appendChild(n); });
    if (state.sheet && state.screen === 'list') app.appendChild(renderSheet());
    if (state.toast) app.appendChild(h('div', { class: 'toast', role: 'status', text: state.toast }));
    updateSendButton();
    syncBackButton();
    window.scrollTo(0, scroll);
  }

  // The list refreshes itself when the app comes back into view; Telegram's own "…" menu has Reload.
  function refreshIfList() {
    if (state.screen === 'list') loadList();
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshIfList();
  });
  // Bot API 8.0: the app was brought back to the front without being reloaded.
  try { if (tg && tg.onEvent) tg.onEvent('activated', refreshIfList); } catch (e) { /* older client */ }

  render();
  loadList();
})();
