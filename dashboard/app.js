// Token Radar — the dashboard page.
//
// The page reads one file, window.RADAR from data.js, and nothing else:
// the snapshot's facts, the model's constants, the ranked rows and the
// live comps. It never fetches, never imports, never reaches the
// network. Everything it shows it computes from that data, including
// the implied value in the detail view, which it recomputes from the
// row's own figures and checks against the number board.json carries.
//
// Views, all driven by the address hash so each one has a link:
//   (no hash)                 the full board
//   #/protocol/<slug>         the board with one protocol's detail open
//   #/category/<name>         the board filtered to one category
//   #/watchlist               the board filtered to the watchlist
//   #/live                    the live-token comps tab

const DATA = window.RADAR;
const ROWS = DATA.rows;
const LIVE = DATA.live;
const WATCHLIST = new Set(DATA.watchlist);
const PARAMS = DATA.model;

// The page's state. The hash writes it; the controls write it; render
// reads it and nothing else.
const state = {
  query: "",
  category: "",
  watchlistOnly: false,
  tab: "pre",
  sortKey: "rank",
  sortDir: 1,
  selected: null,
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Formatting: money, multiples, ages, changes
// ---------------------------------------------------------------------------

function moneyShort(value) {
  if (value >= 1_000_000_000) return "$" + (value / 1_000_000_000).toFixed(2) + "B";
  if (value >= 1_000_000) return "$" + (value / 1_000_000).toFixed(1) + "M";
  if (value >= 1_000) return "$" + (value / 1_000).toFixed(1) + "K";
  return "$" + Math.round(value);
}

function multipleText(value) {
  return value.toFixed(2) + "x";
}

function ageText(ageDays) {
  if (ageDays === null || ageDays === undefined) return "—";
  if (ageDays < 365) return ageDays + "d";
  return (ageDays / 365).toFixed(1) + "y";
}

function changeText(pct) {
  if (pct === null || pct === undefined) return "—";
  const sign = pct > 0 ? "+" : "";
  return sign + pct.toFixed(2) + "%";
}

function changeClass(pct) {
  if (pct === null || pct === undefined) return "";
  return pct >= 0 ? "up" : "down";
}

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// The model, recomputed in the page
// ---------------------------------------------------------------------------

// The same two factors the model applies, from the same constants the
// payload carries. The detail view uses these to recompute a row's
// implied value from its TVL, its multiple, its growth and its age.
function growthFactorOf(pct) {
  const held = pct === null || pct === undefined ? 0 : pct;
  const clamped = Math.max(PARAMS.growth_floor, Math.min(PARAMS.growth_cap, held));
  return 1 + PARAMS.growth_weight * (clamped / 100);
}

function maturityFactorOf(ageDays) {
  const age = ageDays === null || ageDays === undefined ? PARAMS.unknown_age_days : ageDays;
  const share = Math.min(age / PARAMS.maturity_days, 1);
  return PARAMS.maturity_floor + PARAMS.maturity_range * share;
}

function recomputeImplied(row) {
  return Math.round(
    row.tvl_usd *
      row.model.base_multiple *
      growthFactorOf(row.change_7d) *
      maturityFactorOf(row.age_days)
  );
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// The farm's capital tier, by the same TVL bands the model plans with:
// at least $1B puts in $150, at least $100M puts in $100, the rest $50.
function capitalTierOf(tvlUsd) {
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

// ---------------------------------------------------------------------------
// Filtering and sorting
// ---------------------------------------------------------------------------

function visibleRows() {
  const q = state.query.trim().toLowerCase();
  let list = ROWS.filter((row) => {
    if (state.watchlistOnly && !WATCHLIST.has(row.slug)) return false;
    if (state.category && row.category !== state.category) return false;
    if (q) {
      const hay = [row.name, row.category || "", row.chains.join(" ")].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const key = state.sortKey;
  const dir = state.sortDir;
  list = [...list].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (key === "name") return dir * String(av).localeCompare(String(bv));
    if (key === "age_days") {
      av = av === null ? -1 : av;
      bv = bv === null ? -1 : bv;
    }
    if (key === "base_multiple") {
      av = a.model.base_multiple;
      bv = b.model.base_multiple;
    }
    if (av === bv) return a.rank - b.rank;
    return dir * (av - bv);
  });
  return list;
}

// ---------------------------------------------------------------------------
// Rendering: header numbers, cards, table, live tab
// ---------------------------------------------------------------------------

function renderHeader() {
  $("asOf").textContent = DATA.as_of;
  const covered = DATA.watchlist.filter((slug) => ROWS.some((r) => r.slug === slug)).length;
  $("statWatchlist").textContent = covered + " / " + DATA.watchlist_size;
  $("statRows").textContent = String(DATA.board_size);
  $("statEarly").textContent = String(DATA.early_size);
  $("statLive").textContent = String(DATA.live_size);
}

function renderCards() {
  const top = ROWS[0];
  $("cardTop").textContent = moneyShort(top.implied_value_usd);
  $("cardMedian").textContent = multipleText(medianOf(ROWS.map((r) => r.model.base_multiple)));
  const top10 = ROWS.slice(0, 10).reduce((sum, r) => sum + r.implied_value_usd, 0);
  $("cardTop10").textContent = moneyShort(top10);
  const cats = new Set(ROWS.map((r) => r.category).filter((c) => c !== null));
  $("cardCats").textContent = String(cats.size);
}

function renderCategoryOptions() {
  const counts = new Map();
  for (const row of ROWS) {
    if (row.category === null) continue;
    counts.set(row.category, (counts.get(row.category) || 0) + 1);
  }
  const select = $("category");
  const current = state.category;
  select.innerHTML = '<option value="">All categories</option>';
  for (const name of [...counts.keys()].sort()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name + " (" + counts.get(name) + ")";
    select.appendChild(opt);
  }
  select.value = current;
}

function rowHtml(row, maxImplied) {
  const chains = row.chains.slice(0, 2).join(", ");
  const onWatchlist = WATCHLIST.has(row.slug);
  const width = Math.max(2, Math.round((row.implied_value_usd / maxImplied) * 100));
  return (
    "<tr data-slug=\"" + esc(row.slug) + "\"" + (state.selected === row.slug ? ' class="picked"' : "") + ">" +
    "<td class=\"num\">" + row.rank + "</td>" +
    "<td class=\"proto\"><b>" + esc(row.name) + "</b>" +
    "<span class=\"sub\">" + esc(row.category || "No category") + " on " + esc(chains) + "</span>" +
    (onWatchlist ? '<span class="badge">WATCHLIST</span>' : "") +
    "</td>" +
    "<td class=\"num\">" + moneyShort(row.tvl_usd) + "</td>" +
    "<td class=\"num " + changeClass(row.change_7d) + "\">" + changeText(row.change_7d) + "</td>" +
    "<td class=\"num\">" + ageText(row.age_days) + "</td>" +
    "<td class=\"num mult\">" + multipleText(row.model.base_multiple) + "</td>" +
    "<td><span class=\"valuecell\"><span class=\"bar\"><i style=\"width:" + width + "%\"></i></span><b>" +
    moneyShort(row.implied_value_usd) + "</b></span></td>" +
    "<td><span class=\"tokenflag\"><i></i>no token</span></td>" +
    "</tr>"
  );
}

function renderBoard() {
  const list = visibleRows();
  const maxImplied = ROWS[0].implied_value_usd;
  $("rows").innerHTML = list.map((row) => rowHtml(row, maxImplied)).join("");
  $("empty").hidden = list.length > 0;
  $("rowCount").textContent = list.length + " row" + (list.length === 1 ? "" : "s") + " shown";
  document.querySelectorAll("#board thead th[data-sort]").forEach((th) => {
    const key = th.dataset.sort;
    const label = th.textContent.replace(/ [▲▼]$/, "");
    th.textContent = label + (state.sortKey === key ? (state.sortDir === 1 ? " ▲" : " ▼") : "");
  });
}

function renderLive() {
  const sorted = [...LIVE].sort((a, b) => b.mcap_usd - a.mcap_usd);
  $("liveRows").innerHTML = sorted.map((p) => {
    const ratio = p.mcap_usd / p.tvl_usd;
    return (
      "<tr>" +
      "<td class=\"proto\"><b>" + esc(p.name) + "</b>" +
      "<span>" + esc(p.category || "No category") + " on " + esc(p.chains.slice(0, 2).join(", ")) + "</span></td>" +
      "<td>" + esc(p.category || "—") + "</td>" +
      "<td class=\"num\">" + moneyShort(p.tvl_usd) + "</td>" +
      "<td class=\"num\">" + moneyShort(p.mcap_usd) + "</td>" +
      "<td class=\"num mult\">" + multipleText(ratio) + "</td>" +
      "<td class=\"num " + changeClass(p.change_7d) + "\">" + changeText(p.change_7d) + "</td>" +
      "</tr>"
    );
  }).join("");
  $("rowCount").textContent = LIVE.length + " rows shown";
}

function renderTabs() {
  const pre = state.tab === "pre";
  $("tabPre").classList.toggle("on", pre);
  $("tabLive").classList.toggle("on", !pre);
  $("tabPre").setAttribute("aria-selected", String(pre));
  $("tabLive").setAttribute("aria-selected", String(!pre));
  document.querySelector(".tablewrap").hidden = !pre;
  $("livewrap").hidden = pre;
  $("tableNote").textContent = pre
    ? "Pre-token protocols, strongest implied value first. Select a row for its model, its comps and its farm plan."
    : "Live-token protocols, largest market cap first.";
}

// ---------------------------------------------------------------------------
// Rendering: the detail drawer
// ---------------------------------------------------------------------------

function detailHtml(row) {
  const onWatchlist = WATCHLIST.has(row.slug);
  const m = row.model;
  const again = recomputeImplied(row);
  const matches = again === row.implied_value_usd;
  const peersLine =
    m.peer_count > 0
      ? m.peer_count + " live peers in " + (row.category || "this category")
      : "too few, market median used";
  const capital = capitalTierOf(row.tvl_usd);
  const gas = row.farm_budget_usd - capital;
  const steps = row.farm_steps.map((step) => {
    const at = step.indexOf(" Cost: ");
    const action = at >= 0 ? step.slice(0, at) : step;
    const costs = at >= 0 ? step.slice(at + 1) : "";
    return "<li><p>" + esc(action) + "</p>" + (costs ? "<code>" + esc(costs) + "</code>" : "") + "</li>";
  }).join("");
  return (
    '<div class="detail">' +
    '<p class="crumb">Rank ' + row.rank + " of " + ROWS.length + (onWatchlist ? " · watchlist" : " · early") + "</p>" +
    "<h2>" + esc(row.name) + "</h2>" +
    '<p class="sub">' + esc(row.category || "No category") + " on " + esc(row.chains.join(", ")) + "</p>" +
    "<h3>Implied value</h3>" +
    '<div class="kv"><span>TVL</span><b>' + moneyShort(row.tvl_usd) + "</b></div>" +
    '<div class="kv"><span>Seven-day growth</span><b>' + changeText(row.change_7d) + "</b></div>" +
    '<div class="kv"><span>Age with no token</span><b>' + ageText(row.age_days) + "</b></div>" +
    '<div class="kv"><span>Comps multiple</span><b>' + multipleText(m.base_multiple) + "</b></div>" +
    '<div class="kv"><span>Growth multiplier</span><b>' + m.growth_multiplier.toFixed(3) + "</b></div>" +
    '<div class="kv"><span>Maturity multiplier</span><b>' + m.maturity_multiplier.toFixed(4) + "</b></div>" +
    '<div class="kv"><span>Implied value</span><b class="em">' + moneyShort(row.implied_value_usd) + "</b></div>" +
    '<p class="note">Model radar-2: the same function scores every protocol. The page recomputes this row as ' +
    moneyShort(again) + (matches ? ", the same number board.json carries." : ", while board.json carries " + moneyShort(row.implied_value_usd) + ".") +
    " This is an estimate, not a price.</p>" +
    "<h3>The comps behind the multiple</h3>" +
    '<div class="kv"><span>Live peers in ' + esc(row.category || "this category") + "</span><b>" + esc(peersLine) + "</b></div>" +
    '<div class="kv"><span>Peer median (mcap / TVL)</span><b>' + multipleText(m.peer_median) + "</b></div>" +
    '<div class="kv"><span>Market-wide median</span><b>' + multipleText(DATA.global_median_multiple) + "</b></div>" +
    '<div class="kv"><span>Blended multiple</span><b>' + multipleText(m.base_multiple) + "</b></div>" +
    '<p class="note">The multiple is 0.65 x the category peer median plus 0.35 x the market median, so a thin category cannot set the price alone. Open the Live token tab to see the protocols that price this row.</p>' +
    "<h3>Farm plan</h3>" +
    '<div class="farmbox"><div><strong>about $' + row.farm_budget_usd + "</strong><span>Total budget: $" + capital + " of capital plus about $" + gas + " of gas</span></div>" +
    "<div><strong>about " + row.farm_minutes + " minutes</strong><span>Total time, spread over " + row.farm_days + " days</span></div></div>" +
    '<ol class="steps">' + steps + "</ol>" +
    "</div>"
  );
}

function renderDetail() {
  const drawer = $("drawer");
  const scrim = $("scrim");
  if (!state.selected) {
    drawer.hidden = true;
    scrim.hidden = true;
    $("detail").innerHTML = "";
    return;
  }
  const row = ROWS.find((r) => r.slug === state.selected);
  if (!row) {
    state.selected = null;
    drawer.hidden = true;
    scrim.hidden = true;
    return;
  }
  $("detail").innerHTML = detailHtml(row);
  drawer.hidden = false;
  scrim.hidden = false;
}

// ---------------------------------------------------------------------------
// Hash routing
// ---------------------------------------------------------------------------

function applyHash() {
  const hash = window.location.hash || "";
  const match = hash.match(/^#\/protocol\/(.+)$/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    if (ROWS.some((r) => r.slug === slug)) {
      state.tab = "pre";
      state.selected = slug;
      renderAll();
      return;
    }
  }
  if (hash === "#/live") {
    state.tab = "live";
    state.selected = null;
    renderAll();
    return;
  }
  if (hash === "#/watchlist") {
    state.tab = "pre";
    state.watchlistOnly = true;
    $("watchlistOnly").checked = true;
    state.selected = null;
    renderAll();
    return;
  }
  const cat = hash.match(/^#\/category\/(.+)$/);
  if (cat) {
    state.tab = "pre";
    state.category = decodeURIComponent(cat[1]);
    state.selected = null;
    renderAll();
    return;
  }
  state.selected = null;
  renderAll();
}

function renderAll() {
  renderHeader();
  renderCards();
  renderCategoryOptions();
  renderTabs();
  if (state.tab === "pre") renderBoard();
  else renderLive();
  renderDetail();
  $("search").value = state.query;
  $("category").value = state.category;
  $("watchlistOnly").checked = state.watchlistOnly;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

$("search").addEventListener("input", (event) => {
  state.query = event.target.value;
  if (state.tab === "pre") renderBoard();
});

$("category").addEventListener("change", (event) => {
  state.category = event.target.value;
  if (state.tab === "pre") renderBoard();
});

$("watchlistOnly").addEventListener("change", (event) => {
  state.watchlistOnly = event.target.checked;
  if (state.tab === "pre") renderBoard();
});

$("tabPre").addEventListener("click", () => {
  state.tab = "pre";
  renderTabs();
  renderBoard();
});

$("tabLive").addEventListener("click", () => {
  state.tab = "live";
  renderTabs();
  renderLive();
});

document.querySelectorAll("#board thead th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir = -state.sortDir;
    else {
      state.sortKey = key;
      state.sortDir = key === "name" ? 1 : -1;
    }
    renderBoard();
  });
});

$("rows").addEventListener("click", (event) => {
  const tr = event.target.closest("tr[data-slug]");
  if (!tr) return;
  window.location.hash = "#/protocol/" + encodeURIComponent(tr.dataset.slug);
});

$("drawerClose").addEventListener("click", () => {
  window.location.hash = "";
  state.selected = null;
  renderDetail();
  renderBoard();
});

$("scrim").addEventListener("click", () => {
  window.location.hash = "";
  state.selected = null;
  renderDetail();
  renderBoard();
});

window.addEventListener("hashchange", applyHash);

applyHash();
