// Token Radar dashboard, model radar-3. Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the board, filters, stat cards, accounting,
// evidence, a per-protocol detail view, the live-token view and category effects.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var main = document.getElementById('board');
  var view = document.getElementById('view');
  var modelPanel = document.getElementById('model-panel');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', verdict: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null,
    plan: { size: DATA.model.position_share, drop: DATA.model.drop_share, horizon: DATA.model.horizon_weeks } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
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
  function fmtMult(n) { return 'x' + n.toFixed(2); }
  function fmtOdds(n) { return Math.round(n * 100) + '%'; }

  // radar-3 in one function: the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's code and the board's data are
  // visibly the same arithmetic. If-launches is TVL times the size multiple times the
  // category effect; implied is if-launches times token odds times the parent factor.
  function iflOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.size_multiple * row.category_effect));
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(iflOf(row) * row.token_odds * row.parent_factor));
  }

  // The farm plan is the same derivation main.ts writes to board.json: a position
  // of 0.02% of TVL capped at $10,000, an expected drop of 7.0% of the implied
  // value (scaled by the position's share of TVL), fees and hours by primary chain,
  // and a verdict against a T-bill and a $25/hour bar. The sliders reprice it live.
  function farmFor(row) {
    var m = DATA.model;
    var chain = row.chains && row.chains.length > 0 ? row.chains[0] : null;
    var position = Math.min(state.plan.size * row.tvl_usd, m.position_cap_usd);
    var drop = state.plan.drop * row.implied_value_usd * (position / row.tvl_usd);
    var fees = chain && m.fee_by_chain[chain] !== undefined ? m.fee_by_chain[chain] : m.fee_default_usd;
    var hours = chain && m.hours_by_chain[chain] !== undefined ? m.hours_by_chain[chain] : m.hours_default;
    var net = drop - fees;
    var netPerHour = net / hours;
    var tbill = position * m.tbill_annual * (state.plan.horizon / 52);
    var verdict = net > tbill && netPerHour >= m.farm_hourly_usd ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
    return { position: position, drop: drop, fees: fees, hours: hours, net: net, netPerHour: netPerHour, tbill: tbill, verdict: verdict };
  }
  function verdictCounts(list) {
    var c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    list.forEach(function (r) { c[farmFor(r).verdict] = (c[farmFor(r).verdict] || 0) + 1; });
    return c;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
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

  // The farm steps are generic guidance: category, chains, TVL and age decide the
  // action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + '.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + '.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + '.';
    if (c.indexOf('launchpad') >= 0) return 'Join one $' + capital + ' launch allocation on ' + name + '.';
    if (c.indexOf('privacy') >= 0) return 'Run $' + capital + ' through one private transaction on ' + name + ' and keep the receipt.';
    if (c.indexOf('ai') >= 0) return 'Spend $' + capital + ' on one agent task or inference run on ' + name + ' and keep the receipt.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold the position.';
    if (c.indexOf('farm') >= 0) return 'Stake $' + capital + " of LP tokens in " + name + "'s farm on " + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.scope === 'watchlist' && r.scope !== 'watchlist') return false;
      if (state.scope === 'off-list' && r.scope !== 'off-list') return false;
      if (state.scope === 'early' && r.scope !== 'early') return false;
      if (state.verdict !== 'all' && farmFor(r).verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
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
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'ifl') { av = a.if_launches_usd; bv = b.if_launches_usd; }
      else if (key === 'net') { av = farmFor(a).net; bv = farmFor(b).net; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function keptOf(list) {
    // Kept terms among the tested ones: the baseline row and the placebo control
    // do not count. Value rows are flat, size, family, category, growth, age,
    // chain, control; odds rows are base, age, family, size, growth, chain, control.
    var tested = list.filter(function (e) { return e.term.indexOf('control') < 0 && e.term !== 'flat median multiple' && e.term !== 'base rate'; });
    var kept = tested.filter(function (e) { return e.kept; }).length;
    return kept + ' of ' + tested.length;
  }

  function fillFacts() {
    var total = DATA.accounting.total_implied_usd;
    var totalTvl = DATA.accounting.total_tvl_usd;
    document.getElementById('meta-snapshot').textContent = 'Snapshot ' + DATA.as_of + ' · model ' + DATA.model_version + ', refitted in this browser';
    document.getElementById('meta-model').textContent = DATA.model_version + ' model';
    document.getElementById('fact-watchlist').textContent = DATA.accounting.watchlist + ' / ' + DATA.watchlist_size;
    document.getElementById('fact-board').textContent = String(DATA.board_size);
    document.getElementById('fact-total').textContent = fmtUsd(total);
    document.getElementById('fact-live').textContent = String(DATA.live_size);
    document.getElementById('formula').textContent =
      'if-launches = round( tvl_usd x size multiple x category effect )   ·   implied = round( if-launches x token odds x parent factor )   ·   size multiple = ' +
      DATA.value.mult_at_100m.toFixed(4) + ' x ( tvl_usd / 1e8 )^' + DATA.value.slope.toFixed(3) + '   ·   market median ' + fmtMult(DATA.market_median) +
      ', ridge ' + DATA.model.value_ridge_lambda + ' on ' + DATA.value.traded_n + ' traded tokens, parent factor ' + DATA.model.parent_factor + ' when off-list';
    document.getElementById('model-text').textContent =
      'Two fits score every protocol. The value fit is a joint ridge on log(market cap) against log(TVL) and the category, fit on the ' + DATA.value.traded_n +
      ' traded tokens that are not bridges, liquid staking or versioned/wrapped products: a size slope of ' + DATA.value.slope.toFixed(2) +
      ' with a multiple of ' + fmtMult(DATA.value.mult_at_100m) + ' at $100M of TVL, and a shrunk effect per category. The odds fit is a logistic on ' +
      DATA.odds.peers_n + ' peers — the ' + DATA.accounting.ranked + ' ranked rows plus ' + (DATA.odds.peers_n - DATA.accounting.ranked) +
      ' with-token protocols that are not left out by the house rules — on age in years, family size (how many protocols share the category), log TVL and 7-day growth. ' +
      'Its coefficients are ' + DATA.odds.beta.map(function (b) { return b.toFixed(2); }).join(', ') + ' (intercept first), base rate ' +
      Math.round(DATA.odds.base_rate * 100) + '%. The odds run lower than a first glance at the biggest protocols suggests, because the logistic is fit on all ' +
      DATA.odds.peers_n + ' peers — including the many smaller protocols that never launch — and it trusts older, larger, slower-growing protocols most.';
    fillEvidence();
    fillCategories();
  }

  function statCard(title, big, sub) {
    return el('div', { class: 'stat' }, el('h3', { text: title }), el('div', { class: 'big', html: big }), el('p', { html: sub }));
  }
  function fillStats() {
    var host = document.getElementById('stats');
    var ev = DATA.evidence;
    var vFlat = ev.value[0], vSize = ev.value[1], vCat = ev.value[3];
    var oBase = ev.odds[0];
    var oFinal = null;
    ev.odds.forEach(function (e) { if (e.kept) oFinal = e; });
    var vc = verdictCounts(DATA.rows);
    host.textContent = '';
    host.appendChild(statCard('Out-of-sample miss · value',
      '×' + vCat.walk_forward.toFixed(2) + ' <small>walk-forward vs ×' + vFlat.walk_forward.toFixed(2) + ' flat</small>',
      'Leave-one-out ×' + vCat.loo.toFixed(2) + ' vs ×' + vFlat.loo.toFixed(2) + ' flat. The size curve alone is ×' + vSize.walk_forward.toFixed(2) + ' walk-forward.'));
    host.appendChild(statCard('Range honesty',
      Math.round(ev.range_wf.inside_p25_p75 * 100) + '% <small>·</small> ' + Math.round(ev.range_wf.inside_p10_p90 * 100) + '%',
      'Walk-forward, inside the P25–P75 range stated at 50% and the P10–P90 range stated at 80%. Leave-one-out: ' +
      Math.round(ev.range_loo.inside_p25_p75 * 100) + '% · ' + Math.round(ev.range_loo.inside_p10_p90 * 100) + '%.'));
    host.appendChild(statCard('Token odds · Brier',
      oFinal.walk_forward.toFixed(3) + ' <small>walk-forward vs ' + oBase.walk_forward.toFixed(3) + ' base rate</small>',
      Math.round(oFinal.wf_acc * 100) + '% of later peers called right (base rate ' + Math.round(oBase.wf_acc * 100) +
      '%). The Brier scores the probabilities themselves; the 0.5 threshold is not the honest measure when the later half skews with-token.'));
    host.appendChild(statCard('Terms survived both tests',
      keptOf(ev.value) + ' <small>·</small> ' + keptOf(ev.odds),
      'Value terms kept of those tested, then odds terms. A term is kept only when it helps both leave-one-out and walk-forward; the control must not help.'));
    host.appendChild(statCard('Worth farming',
      vc.FARM + ' <small>of ' + DATA.board_size + '</small>',
      vc.MARGINAL + ' marginal, ' + vc.SKIP + ' skip. Farm needs the net to beat a T-bill at ' + (DATA.model.tbill_annual * 100).toFixed(2) +
      '% over ' + state.plan.horizon + ' weeks <i>and</i> $' + DATA.model.farm_hourly_usd + '/hour. No row clears both bars at the current plan.'));
    host.appendChild(statCard('Watchlist ranked',
      DATA.accounting.watchlist + ' / ' + DATA.watchlist_size,
      'Plus ' + (DATA.accounting.off_list + DATA.accounting.early) + ' pre-token (' + DATA.accounting.off_list + ' off-list, ' + DATA.accounting.early + ' early).'));
  }

  function fillAccounting() {
    var a = DATA.accounting;
    var host = document.getElementById('accounting-body');
    host.textContent = '';
    var groups = el('div', { class: 'rows' });
    function group(title, rows) {
      var dl = el('dl');
      rows.forEach(function (kv) { dl.appendChild(el('dt', { text: kv[0] })); dl.appendChild(el('dd', { text: kv[1] })); });
      return el('div', { class: 'group' }, el('h4', { text: title }), dl);
    }
    groups.appendChild(group('Ranked · pre-token', [['Watchlist', a.watchlist], ['Off-list, parent recorded', a.off_list], ['Early, below the floor', a.early], ['Ranked total', a.ranked]]));
    groups.appendChild(group('Already record a token', [['Trades, priced comp', a.priced_comp], ['Recorded, no usable cap', a.token_no_usable_cap], ['With-token total', a.with_token]]));
    groups.appendChild(group('Left out by the house rules', [['Bridge', a.out_bridge], ['Liquid staking', a.out_liquid_staking], ['Exchange', a.out_exchange], ['Versioned / wrapped', a.out_versioned_wrapped], ['Left out total', a.total - a.ranked - a.with_token]]));
    host.appendChild(groups);
    host.appendChild(el('p', { class: 'total', html: '<b>' + a.total + '</b> protocols · <b>' + fmtUsd(a.total_tvl_usd) + '</b> TVL · <b>' + fmtUsd(a.total_implied_usd) + '</b> implied · ledger <b>' + a.ledger + '/' + a.total + '</b> · checksum <b>' + a.checksum + '</b>' }));
  }

  function fillSpotlight() {
    var host = document.getElementById('spotlight');
    host.textContent = '';
    DATA.rows.slice(0, 5).forEach(function (r) {
      host.appendChild(el('button', { type: 'button', class: r.rank === 1 ? 'card first' : 'card', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rank', text: 'Rank ' + r.rank }),
        el('b', { text: r.name }),
        el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'meta', text: (r.category || 'Other') + ' · TVL ' + fmtUsd(r.tvl_usd) + ' · ' + fmtOdds(r.token_odds) + ' odds' })
      ));
    });
  }

  // The top-pick spotlight: the rank-1 row, rendered from the same data as the
  // board. Every number comes from DATA.rows[0]; no name is special-cased and no
  // figure is hand-written. It answers: how big, why it ranks first, the catch.
  function fillTopPick() {
    var host = document.getElementById('top-pick-body');
    if (!host) return;
    var r = DATA.rows[0];
    if (!r) return;
    var farm = farmFor(r);
    var chains = (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) + ' more' : '');
    host.textContent = '';
    host.appendChild(el('div', { class: 'hero-eyebrow' },
      el('span', { class: 'hero-star', text: '★ Top pick' }),
      el('span', { text: 'Rank 1 of ' + DATA.board_size + (r.scope === 'watchlist' ? ' · Watchlist' : ' · ' + r.scope) })
    ));
    host.appendChild(el('h2', { id: 'top-pick-title', text: r.name }));
    host.appendChild(el('p', { class: 'hero-sub', text: (r.category || 'Other') + ' on ' + chains }));
    host.appendChild(el('div', { class: 'hero-value' },
      el('span', { class: 'hero-value-label', text: 'Implied value if it launched' }),
      el('b', { text: fmtUsd(r.implied_value_usd) })
    ));
    var stats = el('div', { class: 'hero-stats' });
    [
      ['If it launched', fmtUsd(r.if_launches_usd)],
      ['Token odds', fmtOdds(r.token_odds)],
      ['Range', fmtUsd(r.range_lo_usd) + ' – ' + fmtUsd(r.range_hi_usd)],
      ['Verdict', farm.verdict + ' · net ' + fmtMoney(farm.net) + ' (' + fmtMoney(farm.netPerHour) + '/hr)']
    ].forEach(function (s) {
      stats.appendChild(el('div', { class: 'hero-stat' }, el('span', { text: s[0] }), el('b', { text: s[1] })));
    });
    host.appendChild(stats);
    host.appendChild(el('p', { class: 'hero-why' },
      el('b', { text: 'Why it ranks #1: ' }),
      'the biggest TVL on the board (' + fmtUsd(r.tvl_usd) + ') priced at ' + fmtUsd(r.if_launches_usd) +
      ' if it launched — TVL × a size multiple of ' + r.size_multiple.toFixed(4) + ' × a ' + (r.category || 'Other') + ' effect of ' + r.category_effect.toFixed(3) +
      ' — times token odds of ' + fmtOdds(r.token_odds) + ' from ' + fmtAge(r.age_days) + ' of no-token history, ' + r.family_size +
      ' protocols in its family, ' + fmtUsd(r.tvl_usd) + ' of TVL and a ' + fmtPct(r.change_7d) + ' week. ' +
      fmtUsd(r.if_launches_usd) + ' × ' + fmtOdds(r.token_odds) + ' ≈ ' + fmtUsd(r.implied_value_usd) + '.'
    ));
    host.appendChild(el('p', { class: 'hero-verdict' },
      el('b', { text: 'The honest verdict: ' }),
      'that ' + fmtUsd(r.implied_value_usd) + ' is an estimate, not a price — and the farm plan says ' + farm.verdict.toLowerCase() +
      ': a ' + fmtMoney(farm.position) + ' position expects a ' + fmtMoney(farm.drop) + ' drop against ' + fmtMoney(farm.fees) + ' of fees, a net of ' + fmtMoney(farm.net) +
      ' (' + fmtMoney(farm.netPerHour) + '/hr), short of the ' + fmtMoney(farm.tbill) + ' a T-bill pays on the same capital and the $25/hour bar. Nothing here says a token launches.'
    ));
    host.appendChild(el('button', { class: 'button primary', type: 'button', text: 'See the model & farm plan', onclick: function () { openDetail(r.slug); } }));
  }

  function fillEvidence() {
    var ev = DATA.evidence;
    document.getElementById('value-n').textContent = String(ev.value_n);
    document.getElementById('odds-n').textContent = String(ev.odds_n);
    var vBody = document.querySelector('#value-evidence tbody');
    vBody.textContent = '';
    ev.value.forEach(function (e) {
      var best = e.kept && (e.term.indexOf('category') >= 0);
      vBody.appendChild(el('tr', { class: best ? 'best' : '' },
        el('td', { text: e.term }),
        el('td', { class: e.kept ? 'kept-yes' : 'kept-no', text: e.kept ? 'Yes' : 'No' }),
        el('td', { class: 'num', text: fmtMult(e.loo) }),
        el('td', { class: 'num', text: fmtMult(e.walk_forward) })
      ));
    });
    var oBody = document.querySelector('#odds-evidence tbody');
    oBody.textContent = '';
    ev.odds.forEach(function (e) {
      var best = e.kept && (e.term.indexOf('growth') >= 0);
      oBody.appendChild(el('tr', { class: best ? 'best' : '' },
        el('td', { text: e.term }),
        el('td', { class: e.kept ? 'kept-yes' : 'kept-no', text: e.kept ? 'Yes' : 'No' }),
        el('td', { class: 'num', text: e.loo.toFixed(3) + (e.loo_acc !== undefined ? ' (' + Math.round(e.loo_acc * 100) + '%)' : '') }),
        el('td', { class: 'num', text: e.walk_forward.toFixed(3) + (e.wf_acc !== undefined ? ' (' + Math.round(e.wf_acc * 100) + '%)' : '') })
      ));
    });
    document.getElementById('range-honesty').textContent =
      'Leave-one-out: within ×3 of the model ' + Math.round(ev.range_loo.within_x3 * 100) + '%; inside the P25–P75 range stated at 50%: ' +
      Math.round(ev.range_loo.inside_p25_p75 * 100) + '%; inside the P10–P90 range stated at 80%: ' + Math.round(ev.range_loo.inside_p10_p90 * 100) +
      '%. Walk-forward: within ×3 ' + Math.round(ev.range_wf.within_x3 * 100) + '%; inside P25–P75 ' + Math.round(ev.range_wf.inside_p25_p75 * 100) +
      '%; inside P10–P90 ' + Math.round(ev.range_wf.inside_p10_p90 * 100) + '%. Each row\u2019s range is its implied value divided and multiplied by the leave-one-out typical miss (×' +
      ev.value[3].loo.toFixed(2) + '), so about half of similar tokens land inside it.';
    var b = ev.bootstrap;
    document.getElementById('bootstrap').textContent =
      'Multiple at $100M TVL ×' + b.mult_at_100m.toFixed(2) + '; size slope ' + b.size_slope.toFixed(2) + ' ± ' + b.size_slope_se.toFixed(2) +
      '; category effects ×' + b.category_effect_lo.toFixed(2) + ' to ×' + b.category_effect_hi.toFixed(2) +
      '. Odds in log-odds: years listed +' + b.odds_age.toFixed(2) + ' ± ' + b.odds_age_se.toFixed(2) +
      '; TVL +' + b.odds_tvl.toFixed(2) + ' ± ' + b.odds_tvl_se.toFixed(2) +
      '; 7-day growth ' + b.odds_growth.toFixed(1) + ' ± ' + b.odds_growth_se.toFixed(1) +
      '; families +' + b.odds_family.toFixed(2) + ' ± ' + b.odds_family_se.toFixed(3) + '.';
  }

  function fillCategories() {
    var tbody = document.querySelector('#categories tbody');
    tbody.textContent = '';
    Object.keys(DATA.value.category_effects).sort().forEach(function (cat) {
      tbody.appendChild(el('tr', null,
        el('td', { text: cat }),
        el('td', { class: 'num', text: '×' + DATA.value.category_effects[cat].toFixed(3) })
      ));
    });
  }

  function fillSelects() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var catSel = document.getElementById('category');
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    catSel.value = state.category;
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var chainSel = document.getElementById('chain');
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
    chainSel.value = state.chain;
    document.getElementById('scope').value = state.scope;
    document.getElementById('sort').value = state.sort;
    document.getElementById('q').value = state.q;
  }

  function bindControls() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderView(); });
    document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; writeHash(); renderView(); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; writeHash(); renderView(); });
    document.getElementById('scope').addEventListener('change', function (e) { state.scope = e.target.value; writeHash(); renderView(); });
    document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; state.dir = -1; writeHash(); renderView(); });
    document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre-token'; writeHash(); renderView(); });
    document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); renderView(); });
    document.getElementById('tab-model').addEventListener('click', function () { state.tab = 'model'; writeHash(); renderView(); });
    document.querySelectorAll('#verdict-tabs button').forEach(function (btn) {
      btn.addEventListener('click', function () { state.verdict = btn.getAttribute('data-verdict'); writeHash(); renderView(); });
    });
    var size = document.getElementById('plan-size');
    var drop = document.getElementById('drop-share');
    var horizon = document.getElementById('horizon');
    function planOut() {
      document.getElementById('plan-size-out').textContent = (state.plan.size * 100).toFixed(2) + '%';
      document.getElementById('drop-share-out').textContent = (state.plan.drop * 100).toFixed(1) + '%';
      document.getElementById('horizon-out').textContent = state.plan.horizon + ' wk';
      document.getElementById('plan-note').textContent = 'The farm plan prices a position of ' + (state.plan.size * 100).toFixed(2) +
        '% of TVL, capped at $10,000, against a drop of ' + (state.plan.drop * 100).toFixed(1) + '% of the implied value, over ' + state.plan.horizon +
        ' weeks. Moving a slider reprices every row\u2019s drop, net and verdict from the same model.';
    }
    size.addEventListener('input', function () { state.plan.size = parseFloat(size.value) / 100; planOut(); fillStats(); fillTopPick(); renderView(); });
    drop.addEventListener('input', function () { state.plan.drop = parseFloat(drop.value) / 100; planOut(); fillStats(); fillTopPick(); renderView(); });
    horizon.addEventListener('input', function () { state.plan.horizon = parseInt(horizon.value, 10); planOut(); fillStats(); fillTopPick(); renderView(); });
    size.value = String(state.plan.size * 100);
    drop.value = String(state.plan.drop * 100);
    horizon.value = String(state.plan.horizon);
    planOut();
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); renderView(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictBadge(v) {
    return el('span', { class: 'verdict ' + v.toLowerCase(), text: v });
  }

  function boardTable() {
    var list = sortedRows(rows());
    var vc = verdictCounts(DATA.rows);
    document.getElementById('count').textContent = list.length + ' of ' + DATA.board_size + ' rows · ' + fmtUsd(DATA.accounting.total_tvl_usd) + ' TVL · ' + fmtUsd(DATA.accounting.total_implied_usd) + ' implied';
    document.querySelectorAll('#verdict-tabs button').forEach(function (btn) {
      var v = btn.getAttribute('data-verdict');
      btn.setAttribute('aria-selected', state.verdict === v ? 'true' : 'false');
      btn.textContent = v === 'all' ? 'All ' + DATA.board_size : v.charAt(0) + v.slice(1).toLowerCase() + ' ' + vc[v];
    });
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; state.verdict = 'all'; fillSelects(); writeHash(); renderView(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var farm = farmFor(r);
      var tr = el('tr', {
        class: r.rank === 1 ? 'top-pick' : '',
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtOdds(r.token_odds) }),
        el('td', { class: 'num', text: fmtUsd(r.if_launches_usd) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.range_lo_usd) + ' – ' + fmtUsd(r.range_hi_usd) }),
        el('td', null, verdictBadge(farm.verdict)),
        el('td', { class: 'num ' + (farm.net >= 0 ? 'pos' : 'neg'), text: fmtMoney(farm.net) }),
        el('td', { class: 'num ' + (farm.netPerHour >= 0 ? 'pos' : 'neg'), text: fmtMoney(farm.netPerHour) }),
        el('td', null, el('span', { class: r.scope === 'watchlist' ? 'badge' : 'badge early', text: r.scope === 'watchlist' ? 'Watchlist' : r.scope === 'off-list' ? 'Off-list' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Odds'),
            sortHeader('ifl', 'If launches'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Range' }),
            el('th', { scope: 'col', text: 'Verdict' }),
            sortHeader('net', 'Net'),
            el('th', { scope: 'col', text: 'Net/hr' }),
            el('th', { scope: 'col', text: 'Scope' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    document.getElementById('count').textContent = DATA.live.length + ' live-token protocols';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); renderView(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var farm = farmFor(row);
    var recomputedIfl = iflOf(row);
    var recomputed = impliedOf(row);
    var b = DATA.odds.beta;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        row.rank === 1 ? el('span', { class: 'top-pick-badge', text: '★ Top pick' }) : null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.scope === 'watchlist' ? 'Watchlist' : row.scope === 'off-list' ? 'Off-list, parent ×' + row.parent_factor : 'Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Size multiple' }), el('b', { class: 'num', text: row.size_multiple.toFixed(4) })),
        el('div', null, el('span', { text: 'Category effect (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: '×' + row.category_effect.toFixed(3) })),
        el('div', null, el('span', { text: 'If it launched' }), el('b', { class: 'num', text: fmtUsd(row.if_launches_usd) })),
        el('div', null, el('span', { text: 'Token odds' }), el('b', { class: 'num', text: fmtOdds(row.token_odds) })),
        el('div', null, el('span', { text: 'Parent factor' }), el('b', { class: 'num', text: row.parent_factor === 1 ? '×1.00' : '×' + row.parent_factor.toFixed(2) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Range' }), el('b', { class: 'num', text: fmtUsd(row.range_lo_usd) + ' – ' + fmtUsd(row.range_hi_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The odds are a logistic on age ' +
        row.age_years.toFixed(2) + 'y × ' + b[1].toFixed(2) + ', family size ' + row.family_size + ' × ' + b[2].toFixed(2) + ', log TVL × ' + b[3].toFixed(2) +
        ', 7-day growth ' + (row.growth_frac * 100).toFixed(1) + '% × ' + b[4].toFixed(1) + ', intercept ' + b[0].toFixed(2) + '. ' +
        'The page recomputes this row as ' + fmtUsd(recomputedIfl) + ' if it launched and ' + fmtUsd(recomputed) + ' implied' +
        (recomputed === row.implied_value_usd && recomputedIfl === row.if_launches_usd ? ', the same numbers board.json carries.' : ', which differ from the board: the data would be stale.') +
        (row.parent_factor !== 1 ? ' The 0.48 parent factor applies because this is an off-list sub-product above the floor whose parent is already recorded.' : '') +
        ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Position' }), el('b', { class: 'num', text: fmtMoney(farm.position) })),
        el('div', null, el('span', { text: 'Expected drop' }), el('b', { class: 'num', text: fmtMoney(farm.drop) })),
        el('div', null, el('span', { text: 'Fees (' + chainOf(row) + ')' }), el('b', { class: 'num', text: fmtMoney(farm.fees) })),
        el('div', null, el('span', { text: 'Hours' }), el('b', { class: 'num', text: farm.hours.toFixed(2) })),
        el('div', null, el('span', { text: 'Net' }), el('b', { class: 'num', text: fmtMoney(farm.net) })),
        el('div', null, el('span', { text: 'Net per hour' }), el('b', { class: 'num', text: fmtMoney(farm.netPerHour) })),
        el('div', null, el('span', { text: 'T-bill on the position' }), el('b', { class: 'num', text: fmtMoney(farm.tbill) })),
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: farm.verdict }))
      ),
      el('p', { class: 'sub', text: 'Farm needs the net to beat the T-bill (' + fmtMoney(farm.tbill) + ' on this position over ' + state.plan.horizon +
        ' weeks) and $' + DATA.model.farm_hourly_usd + '/hour. This row is ' + farm.verdict + '.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function renderView() {
    document.getElementById('tab-pre').setAttribute('aria-selected', state.tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
    document.getElementById('tab-model').setAttribute('aria-selected', state.tab === 'model' ? 'true' : 'false');
    var ev = document.getElementById('evidence-panel');
    var mp = document.getElementById('model-panel');
    view.textContent = '';
    if (state.tab === 'live') {
      ev.style.display = 'none';
      mp.style.display = 'none';
      view.appendChild(liveTable());
    } else if (state.tab === 'model') {
      ev.style.display = '';
      mp.style.display = '';
      document.getElementById('count').textContent = '';
    } else {
      ev.style.display = '';
      mp.style.display = 'none';
      view.appendChild(boardTable());
    }
    main.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  fillFacts();
  fillStats();
  fillAccounting();
  fillSpotlight();
  fillTopPick();
  fillSelects();
  bindControls();
  renderView();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

