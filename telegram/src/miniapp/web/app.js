// Mini App page. Plain DOM, no dependencies. All text from the server is set with textContent,
// never as HTML.
(function () {
  'use strict';

  var tg = window.Telegram && window.Telegram.WebApp;
  var initData = tg && tg.initData ? tg.initData : '';
  var base = location.pathname.replace(/\/+$/, '');
  var app = document.getElementById('app');

  var state = {
    screen: 'list', // list | set | finished
    list: null,
    detail: null,
    answers: Object.create(null), // questionId -> { selected: [], other: '', text: '', skip: false }
    results: Object.create(null), // questionId -> { status, reason }
    sending: false,
    finished: null,
    error: null,
  };

  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) { /* not fatal */ }
    try { if (tg.BackButton) tg.BackButton.onClick(function () { goList(); }); } catch (e) { /* not fatal */ }
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
    state.screen = 'list';
    state.detail = null;
    state.finished = null;
    state.error = null;
    if (tg && tg.BackButton) { try { tg.BackButton.hide(); } catch (e) { /* ignore */ } }
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
    state.answers = loadDraft(id);
    state.results = Object.create(null);
    state.finished = null;
    api('batches/' + id).then(function (r) {
      if (r.status === 404) { goList(); return; }
      state.detail = r.body;
      state.screen = 'set';
      state.error = null;
      if (tg && tg.BackButton) { try { tg.BackButton.show(); } catch (e) { /* ignore */ } }
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
    var previous = state.detail;
    api('batches/' + batchId + '/answers', { method: 'POST', body: JSON.stringify({ answers: answers }) }).then(function (r) {
      state.sending = false;
      if (r.status !== 200) { state.error = 'The bot could not take that submission. Try again.'; render(); return; }
      var outcome = r.body;
      state.results = Object.create(null);
      outcome.results.forEach(function (res) { state.results[res.questionId] = res; });
      // Keep only the answers that did not go through, so they can be corrected and sent again.
      Object.keys(state.results).forEach(function (id) { if (state.results[id].status === 'ok') delete state.answers[id]; });
      saveDraft();
      return api('batches/' + batchId).then(function (d) {
        if (d.status === 404) {
          clearDraft(batchId);
          state.finished = { batchStatus: outcome.batchStatus, previous: previous, results: outcome.results };
          state.screen = 'finished';
          state.detail = null;
          if (tg && tg.BackButton) { try { tg.BackButton.show(); } catch (e) { /* ignore */ } }
        } else {
          state.detail = d.body;
        }
        render();
      });
    }).catch(function (error) { state.sending = false; fail(error); });
  }

  // ---- rendering ----

  function renderList() {
    var nodes = [];
    nodes.push(h('div', { class: 'row' },
      h('h1', { text: 'Open questions' }),
      h('button', { class: 'link', text: 'Refresh', onclick: loadList })));
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
      nodes.push(h('button', { class: 'card', onclick: function () { openSet(b.id); } },
        h('h2', { text: b.title }),
        h('div', { class: 'meta hint' },
          h('span', { text: b.asker }),
          h('span', { text: b.done + ' of ' + b.total + ' answered' }),
          h('span', { text: ago(b.createdAt) }),
          due ? h('span', { text: due }) : null),
        bar));
    });
    return nodes;
  }

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
        opt.description ? h('span', { class: 'desc', text: opt.description }) : null));
  }

  function resultNote(q) {
    var r = state.results[q.id];
    if (!r || r.status === 'ok') return null;
    return h('div', { class: 'note error', text: r.reason || 'This answer was not sent.' });
  }

  function questionNode(q, index, total) {
    var card = h('section', { class: 'card' });
    card.appendChild(h('div', { class: 'qnum', text: 'Question ' + (index + 1) + ' of ' + total }));
    card.appendChild(h('p', { class: 'prompt', text: q.prompt }));

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
      body.appendChild(h('textarea', {
        placeholder: q.placeholder || 'Your answer',
        value: a.text,
        oninput: function (e) { a.text = e.target.value; updateSendButton(); },
      }));
    } else {
      q.options.forEach(function (opt) { body.appendChild(optionNode(q, opt, a, rerender)); });
      if (q.allowOther) {
        body.appendChild(h('input', {
          type: 'text',
          placeholder: 'Other, or a note',
          value: a.other,
          oninput: function (e) {
            a.other = e.target.value;
            if (q.type === 'single' && a.other.trim()) { a.selected = []; refreshSelection(card); }
            updateSendButton();
          },
        }));
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
    // PR 2 adds the per-question "In chat" link here.
    card.appendChild(h('div', { 'data-slot': 'question-actions' }));
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

  function renderSet() {
    var d = state.detail;
    var nodes = [];
    nodes.push(h('div', { class: 'row' },
      h('button', { class: 'link', text: '‹ Back', onclick: goList }),
      // PR 2 adds the "…" menu here.
      h('div', { 'data-slot': 'set-menu' })));
    nodes.push(h('h1', { text: d.title }));
    nodes.push(h('div', { class: 'hint', text: 'Asked by ' + d.asker + ' · ' + ago(d.createdAt) + ' · read at ' + time(d.readAt) }));
    if (d.message) nodes.push(h('p', { class: 'message', text: d.message }));
    d.questions.forEach(function (q, i) { nodes.push(questionNode(q, i, d.questions.length)); });
    var bar = h('div', { class: 'bottom' }, h('button', { id: 'send', class: 'send', onclick: send }));
    nodes.push(bar);
    return nodes;
  }

  function renderFinished() {
    var f = state.finished;
    var nodes = [h('h1', { text: f.batchStatus === 'submitted' ? 'All answered' : 'This set is closed' })];
    var problems = f.results.filter(function (r) { return r.status !== 'ok'; });
    if (!problems.length) nodes.push(h('p', { class: 'hint', text: 'Your answers were sent.' }));
    problems.forEach(function (r) {
      var q = f.previous.questions.filter(function (x) { return x.id === r.questionId; })[0];
      nodes.push(h('div', { class: 'card' },
        h('p', { class: 'prompt', text: q ? q.prompt : r.questionId }),
        h('div', { class: 'note error', text: r.reason || 'This answer was not sent.' })));
    });
    nodes.push(h('button', { class: 'link', text: 'Back to open questions', onclick: goList }));
    return nodes;
  }

  function render() {
    var scroll = window.scrollY;
    app.textContent = '';
    if (state.error) {
      app.appendChild(h('div', { class: 'card' }, h('p', { class: 'note error', text: state.error })));
      if (state.screen === 'list' && !state.list) return;
    }
    var nodes = state.screen === 'set' && state.detail ? renderSet() : state.screen === 'finished' && state.finished ? renderFinished() : renderList();
    nodes.forEach(function (n) { app.appendChild(n); });
    updateSendButton();
    window.scrollTo(0, scroll);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.screen === 'list') loadList();
  });

  render();
  loadList();
})();
