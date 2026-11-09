// EVENTS comes from events_data.js (made by test_WebGIS.py)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Ziyi add this to get today's date in Arizona
function asuToday() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Phoenix',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date())
      .map(p => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// "Free" and "Open to the public" are on almost everything, so they're not categories
const NOT_CATEGORY = ['Free', 'Open to the public'];
const events = EVENTS.map(e => {
  const topics = String(e.event_topics || '').split('|').filter(Boolean);
  const cats = topics.filter(t => !NOT_CATEGORY.includes(t));
  return {...e, cats: cats.length ? cats : ['Other'], free: topics.includes('Free'),
          time: String(e.start_date || '').split(' - ')[1] || '',
          key: e.lat != null ? e.lat.toFixed(5) + ',' + e.lon.toFixed(5) : null};
}).sort((a, b) => String(a.start).localeCompare(String(b.start)));

const state = {q: '', when: 'all', free: false, cats: new Set()};

// map
const map = L.map('map', {zoomControl: false}).setView([33.4215, -111.9330], 15);
L.control.zoom({position: 'topright'}).addTo(map);
// Esri tiles (OSM tiles get blocked when opening from file://)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, USGS, NGA, OpenStreetMap contributors'}).addTo(map);

const pinSize = n => Math.min(44, Math.round(22 + 4 * Math.sqrt(n)));
const cluster = L.markerClusterGroup({
  maxClusterRadius: 35, showCoverageOnHover: false,
  iconCreateFunction: c => {
    const n = c.getAllChildMarkers().reduce((s, m) => s + m.options.count, 0);
    const size = pinSize(n) + 4;
    return L.divIcon({html: `<div class="pin big" style="width:${size}px;height:${size}px">${n}</div>`,
                      className: '', iconSize: [size, size]});
  }
}).addTo(map);
let markers = {};

// filter controls
const WHEN = [['all', 'All dates'], ['0', 'Today'], ['7', 'Next 7 days'], ['free', 'Free']];
document.getElementById('when').innerHTML = WHEN.map(([v, t]) =>
  `<button class="chip" data-when="${v}">${t}</button>`).join('');

const catCount = {};
new Map(events.map(e => [e.nid, e])).forEach(e => e.cats.forEach(c => catCount[c] = (catCount[c] || 0) + 1));
document.getElementById('cats').innerHTML = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])
  .map(c => `<button class="chip" data-cat="${esc(c)}">${esc(c)}<span class="n">${catCount[c]}</span></button>`).join('');

//Ziyi change this 
function dateOk(d) {
  if (state.when === 'all') return true;
  const today = asuToday();
  const [y, m, day] = today.split('-').map(Number);
  const end = new Date( Date.UTC(y, m - 1, day + Number(state.when))).toISOString().slice(0, 10);
  return d >= today && d <= end;
}

function matches(e) {
  if (state.cats.size && !e.cats.some(c => state.cats.has(c))) return false;
  if (state.free && !e.free) return false;
  if (!dateOk(e.date)) return false;
  if (state.q) {
    const hay = [e.title, e.locations, e.venue_address, e.campus].join(' ').toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}

function where(e) {
  if (e.key) return e.locations || e.venue_address;
  if (e.is_online) return 'Online';
  return (e.locations || e.campus || 'Location TBA');
}

function render() {
  document.querySelectorAll('[data-when]').forEach(b => b.classList.toggle('on',
    b.dataset.when === 'free' ? state.free : b.dataset.when === state.when));
  document.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('on', state.cats.has(b.dataset.cat)));

  const shown = events.filter(matches);

  // list: one card per event, recurring ones show the next date + count
  const groups = new Map();
  shown.forEach(e => groups.has(e.nid) ? groups.get(e.nid).push(e) : groups.set(e.nid, [e]));
  const list = document.getElementById('list');
  list.innerHTML = groups.size ? [...groups.values()].map(occ => {
    const e = occ[0];
    const [y, m, d] = String(e.date).split('-');
    return `<div class="card${e.key ? '' : ' nomap'}" data-key="${e.key || ''}">
      <div class="date"><span class="m">${MONTHS[m - 1] || ''}</span><span class="d">${Number(d) || ''}</span></div>
      <div class="body">
        <a class="title" href="${esc(e.alias)}" target="_blank">${esc(e.title)}</a>
        <div class="meta">${esc(e.time)} &middot; ${esc(where(e))}${occ.length > 1 ? ` &middot; +${occ.length - 1} more dates` : ''}</div>
        ${e.key ? '' : `<span class="badge off">${e.is_online ? 'Online' : 'Not on map'}</span>`}
        ${e.free ? '<span class="badge free">Free</span>' : ''}
        ${e.cats.slice(0, 2).map(c => `<span class="badge">${esc(c)}</span>`).join('')}
      </div></div>`;
  }).join('') : '<div class="empty">No events match these filters.</div>';

  // map: one marker per building
  const places = {};
  shown.filter(e => e.key).forEach(e => (places[e.key] = places[e.key] || []).push(e));
  cluster.clearLayers();
  markers = {};
  Object.entries(places).forEach(([key, evs]) => {
    const n = new Set(evs.map(e => e.nid)).size;
    const size = pinSize(n);
    const icon = L.divIcon({className: '', iconSize: [size, size],
      html: `<div class="pin" style="width:${size}px;height:${size}px">${n}</div>`});
    markers[key] = L.marker([evs[0].lat, evs[0].lon], {icon, count: n})
      .bindPopup(() => popupHtml(evs), {maxWidth: 300, minWidth: 240});
    cluster.addLayer(markers[key]);
  });

  const mapped = new Set(shown.filter(e => e.key).map(e => e.nid)).size;
  document.getElementById('sub').textContent =
    `${groups.size} events · ${mapped} on the map · ${dateRange}`;
}

function popupHtml(evs) {
  const seen = new Set();
  const rows = evs.filter(e => !seen.has(e.nid) && seen.add(e.nid));
  const e = evs[0];
  return `<div class="pop"><h3>${esc(e.locations || e.venue_address)}</h3>
    <div class="addr">${esc(e.venue_address)}, ${esc(e.venue_city)}</div>
    <ul>${rows.map(r => `<li><a href="${esc(r.alias)}" target="_blank">${esc(r.title)}</a>
      <div>${esc(r.start_date)}</div></li>`).join('')}</ul></div>`;
}

const fmt = d => { const [y, m, dd] = d.split('-'); return `${MONTHS[m - 1]} ${Number(dd)}`; };
const dates = events.map(e => e.date).filter(Boolean);
const dateRange = dates.length ? `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}` : '';

// events
document.getElementById('q').addEventListener('input', e => { state.q = e.target.value.trim().toLowerCase(); render(); });
document.getElementById('when').addEventListener('click', e => {
  const v = e.target.closest('[data-when]')?.dataset.when;
  if (!v) return;
  if (v === 'free') state.free = !state.free; else state.when = v;
  render();
});
document.getElementById('cats').addEventListener('click', e => {
  const c = e.target.closest('[data-cat]')?.dataset.cat;
  if (!c) return;
  state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c);
  render();
});
document.getElementById('morecats').addEventListener('click', e => {
  const open = document.getElementById('cats').classList.toggle('open');
  e.target.textContent = open ? 'Show fewer' : 'Show all categories';
});
// click a card -> jump to it on the map
document.getElementById('list').addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const m = markers[e.target.closest('.card')?.dataset.key];
  if (m) cluster.zoomToShowLayer(m, () => m.openPopup());
});

render();
