// Token Launch Radar — dashboard. Reads window.RADAR (written beside dashboard/ by main.ts from
// the same board.json the gate scores) and renders: a thesis strip with the top picks, the ranked
// board with search / category / chain / watchlist filters and sortable columns, a per-protocol
// detail drawer with the full model waterfall and the farm plan from board.json itself, a live
// comparables view (protocols whose token already trades, priced by the market, never ranked),
// and the method panel with the category multiples the model derived from this snapshot.
// No network: every byte rendered here ships in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtX(n) { return 'x' + Number(n).toFixed(3); }

  // The model, recomputed in the page: base multiple from the row's category comps, compounded
  // momentum, maturity and breadth. If this number ever differs from the row's implied value,
  // the detail view says so — page and board are the same arithmetic or the page admits it.
  function impliedOf(row) {
    var m = DATA.model;
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = Math.exp(m.growth_rate * g);
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_extra_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.model.base_multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
        if (k === 'checked' && attrs[k]) node.checked = true;
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', r.signal, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'conviction') { av = a.conviction; bv = b.conviction; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'scope' }), el('span', { class: 'brand-name', text: 'Token Launch Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index (sealed)' }))
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        el('p', null,
          'Every protocol in the sealed snapshot that records no token is ranked by what its launch would be worth if its record stayed as it is. ',
          el('b', { text: 'The watchlist is the floor, not the ceiling: ' }),
          'all ' + DATA.watchlist_size + ' watchlist protocols are covered, and the radar keeps going to ' + DATA.board_size + ' rows so the early protocols below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor are ranked too. Implied value is this model\u2019s claim, never a promise — the method below shows every input.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'watchlist protocols covered' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'pre-token protocols ranked' })),
        el('div', { class: 'stat' }, el('b', { text: fmtUsd(DATA.total_tvl_usd) }), el('span', { text: 'combined TVL under watch' })),
        el('div', { class: 'stat' }, el('b', { text: fmtUsd(DATA.median_implied_usd) }), el('span', { text: 'median implied value' }))
      )
    );
  }

  function thesis() {
    var picks = DATA.thesis.slice(0, 3).map(function (t) {
      var row = DATA.rows.filter(function (r) { return r.slug === t.slug; })[0];
      return el('button', { class: 'pick', type: 'button', onclick: function () { openDetail(t.slug); } },
        el('span', { class: 'rk', text: 'RANK ' + t.rank + ' · CONVICTION ' + (row ? row.conviction : '—') + '/100' }),
        el('h3', { text: t.name }),
        el('span', { class: 'val', text: fmtUsd(row ? row.implied_value_usd : 0) + ' implied' }),
        el('p', { text: t.body })
      );
    });
    return el('section', { class: 'thesis' },
      el('h2', null, 'The thesis ', el('span', { text: 'top picks, argued from the snapshot' })),
      el('p', { class: 'sub', text: 'Price the category, not the hype: a pre-token protocol is worth what live protocols in its own category actually trade for per dollar of TVL, adjusted for its momentum, its years without a token, and its chain breadth. These three argue themselves from the figures — open one for the full waterfall and its farm plan.' }),
      el('div', { class: 'picks' }, picks)
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, signal or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watch ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchBox.addEventListener('change', function () { state.watch = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live comparables', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Scope' }), el('label', { class: 'check' }, watchBox, ' Watchlist only')),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', id: 'rowcount', text: '' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderTable(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25BC' : ' \u25B2' }) : null)
    );
  }

  var tableHost = el('div', { id: 'tablehost' });
  var countHost = null;
  function renderTable() {
    tableHost.textContent = '';
    var counter = document.getElementById('rowcount');
    if (state.tab === 'live') {
      if (counter) counter.textContent = DATA.live.length + ' live-token protocols';
      tableHost.appendChild(liveTable());
      return;
    }
    var list = sortedRows(rows());
    if (counter) counter.textContent = list.length + ' of ' + DATA.board_size + ' rows';
    if (list.length === 0) {
      tableHost.appendChild(el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the category and chain filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })
      )));
      return;
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var gClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chipClass = r.watchlist ? 'chip watch' : (r.change_7d !== null && r.change_7d >= 5 ? 'chip hot' : 'chip');
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'no chain listed') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('span', { class: 'bar teal', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, r.conviction) + '%' })), ' ', el('span', { class: 'num', text: String(r.conviction) })),
        el('td', null, el('div', { class: 'implied' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: chipClass, text: r.signal }))
      );
      tbody.appendChild(tr);
    });
    tableHost.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols ranked by implied value. Select any row for its model waterfall and farm plan. Conviction is the model\u2019s 0–100 confidence from size, momentum, age, breadth and comp depth.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('conviction', 'Conviction'),
            sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'Signal' })
          )),
          tbody
        )
      )
    ));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : '') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.ratio === null ? 'n/a' : r.ratio.toFixed(3) + 'x' }),
        el('td', null, el('span', { class: 'chip', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Live comparables: these protocols already have a token, so the market — not the model — sets their value. Their median market-cap / TVL ratio per category is exactly what prices the pre-token board.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    var m = DATA.model;
    var comps = DATA.categories.slice(0, 18).map(function (c) {
      return el('div', { class: 'comp' }, el('span', { text: c.category + ' · ' + c.live_count + ' live' }), el('b', { text: fmtX(c.multiple) }));
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', null,
        el('b', { text: 'One function, every row, no names. ' }),
        'The base multiple is not a guess: it is the median market-cap / TVL ratio of the live-token protocols in the same category inside this snapshot (global live median ', el('b', { text: DATA.global_median_ratio.toFixed(3) + 'x' }), '), shrunk toward that global median when a category has few comps and clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. Momentum compounds the seven-day TVL change, maturity rewards years held with no token, and breadth adds a capped 2% per extra chain. Protocols whose token already trades are never ranked — they are the measuring stick, shown in the Live comparables view.'
      ),
      el('div', { class: 'formula', text: 'implied = round( TVL x base_multiple(category comps) x exp(' + m.growth_rate + ' x clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')) x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ') x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_extra_chains + ')) )' }),
      el('h3', { text: 'Category base multiples derived from this snapshot' }),
      el('div', { class: 'comp-grid' }, comps),
      el('p', { class: 'sub', text: 'A protocol records no token in DefiLlama\u2019s record — that is the claim, and it is why the board says \u201crecords no token\u201d, never \u201chas none\u201d. An unreported age is scored as ' + m.unknown_age_days + ' days. Every figure on this page comes from the sealed snapshot dated ' + DATA.as_of + '.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); renderTable(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    renderTable();
    dialog.textContent = '';
    var check = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : ' · Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'no chain listed') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why this value — the waterfall' }),
      el('div', { class: 'waterfall' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base multiple — ' + row.model.category + ' comps (' + row.model.comp_count + ' live, median ' + row.model.comp_median_ratio.toFixed(3) + 'x)' }), el('b', { text: fmtX(row.model.base_multiple) })),
        el('div', null, el('span', { text: 'Momentum — 7d TVL ' + fmtPct(row.change_7d) + ', compounded' }), el('b', { text: fmtX(row.model.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity — ' + fmtAge(row.age_days) + ' with no token' }), el('b', { text: fmtX(row.model.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth — ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') }), el('b', { text: fmtX(row.model.breadth_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Conviction' }), el('b', { text: row.conviction + ' / 100 · ' + row.signal }))
      ),
      el('p', { class: 'sub', text: 'The page recomputes this row as ' + fmtUsd(check) + (check === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board, so treat the board as stale.') + ' An estimate from the snapshot\u2019s own figures, not a price and not a prediction that a token will exist.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — ' + row.farm_steps.length + ' steps' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        return el('li', null, el('p', { text: s }));
      })),
      el('p', { class: 'sub', text: 'Costs and times are per step, in the step text. Capital tiers scale with the protocol\u2019s own TVL; gas follows its primary chain.' })
    ));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(thesis());
    shell.appendChild(controls());
    shell.appendChild(tableHost);
    shell.appendChild(methodPanel());
    shell.appendChild(el('footer', { class: 'foot' },
      el('span', { text: 'Token Launch Radar · ' + DATA.model_version + ' · snapshot ' + DATA.as_of }),
      el('span', { text: DATA.board_size + ' ranked · ' + DATA.watchlist_size + ' watchlist · ' + DATA.live_size + ' live comps shown' })
    ));
    app.appendChild(shell);
    app.appendChild(dialog);
    app.setAttribute('aria-busy', 'false');
    renderTable();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
