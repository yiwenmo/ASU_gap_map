// ASU Gap Map: which events can I walk to and still make my next class?
// Needs: EVENTS (events_data.js), data/buildings.geojson, data/event_buildings.csv, data/walk_matrix.json,
// and for drawing routes data/walk_network.geojson + data/building_snaps.json (route.js).
// fetch() does not work from file://, so serve the repo root: python3 -m http.server, then open /web/gap.html

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $ = id => document.getElementById(id);
const NOT_CATEGORY = ['Free', 'Open to the public'];

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fmtTime = min => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${(h + 11) % 12 + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const mins = sec => Math.max(1, Math.round(sec / 60));

// Can I make this event? All times in minutes after midnight of the chosen day.
//   leave here at freeFrom -> walk to the event -> be there (or join it in progress) -> stay -> walk to class -> buffer
// You need `stay` minutes there, or the whole event if it is shorter. It must still be on when you arrive.
function check({freeFrom, classStart, evStart, evEnd, stay, buffer, walkTo, walkBack}) {
  if (walkTo == null || walkBack == null) return {ok: false, why: 'No walking route'};
  const arrive = freeFrom + walkTo / 60;
  const need = Math.min(stay, evEnd - evStart);
  const join = Math.max(arrive, evStart);
  if (join + need > evEnd) return {ok: false, why: `Over before you can get there (you'd arrive ${fmtTime(arrive)})`};
  const back = join + need + walkBack / 60 + buffer;
  if (back > classStart) return {ok: false, why: `You'd be ${Math.ceil(back - classStart)} min late for class`};
  return {ok: true, arrive, join, slack: classStart - back};
}

// small CSV reader (handles quoted fields)
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const map = L.map('map', {zoomControl: false}).setView([33.4215, -111.9330], 15);
L.control.zoom({position: 'topright'}).addTo(map);
// Esri tiles (OSM tiles get blocked when opening from file://)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, USGS, NGA, OpenStreetMap contributors'}).addTo(map);
const markerLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

let buildings = {};   // building_id -> {name, lat, lon}
let labelToId = {};   // datalist label -> building_id
let matrix = {};
let events = [];      // EVENTS joined with building_id
let results = [];     // last computed list
const state = {cats: new Set(), free: false, showAll: false, selected: null};

function buildingId(text) {
  const t = text.trim();
  if (labelToId[t]) return labelToId[t];
  const hit = Object.keys(labelToId).filter(l => l.toLowerCase() === t.toLowerCase());
  return hit.length ? labelToId[hit[0]] : (buildings[t.toUpperCase()] ? t.toUpperCase() : null);
}

// "I'm free at" starts as the current time (rounded up to 5 min), so most people never touch it
function setNow() {
  const d = new Date();
  const m = Math.min(23 * 60 + 55, Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5);
  $('free-from').value = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function save() {
  try {
    localStorage.setItem('gapPlan', JSON.stringify(
      Object.fromEntries(['origin', 'dest', 'class-time', 'stay', 'buffer'].map(k => [k, $(k).value]))));
  } catch (e) { /* storage can be blocked, the page still works */ }
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('gapPlan') || '{}');
    Object.entries(s).forEach(([k, v]) => { if ($(k)) $(k).value = v; });
  } catch (e) { /* ignore */ }
}

function compute() {
  const o = buildingId($('origin').value), d = buildingId($('dest').value);
  const msg = $('gap-msg');
  const setMsg = (t, cls) => { msg.textContent = t; msg.className = cls || ''; };
  routeLayer.clearLayers();
  results = [];
  if (!o || !d) { setMsg('Pick your location and your class building from the list.', 'err'); return draw(o, d); }
  const freeFrom = toMin($('free-from').value), classStart = toMin($('class-time').value);
  const gap = classStart - freeFrom;
  if (gap <= 0) { setMsg('Your class has to start after you are free.', 'err'); return draw(o, d); }
  const direct = matrix[o]?.[d];
  setMsg(`${fmtTime(freeFrom)} to ${fmtTime(classStart)}: ${gap} min gap. Direct walk to class: ${direct != null ? mins(direct) + ' min' : 'no route'}.`, 'ok');

  const stay = Number($('stay').value), buffer = Number($('buffer').value), day = $('day').value;
  results = events.filter(e => e.date === day && e.building_id).map(e => {
    const evStart = toMin(e.start.slice(11, 16));
    // end can be on a later day (exhibitions, multi-day events), so count minutes from midnight of the chosen day
    const evEnd = e.end ? (new Date(e.end) - new Date(day + 'T00:00')) / 60000 : evStart + stay;
    const walkTo = matrix[o]?.[e.building_id], walkBack = matrix[e.building_id]?.[d];
    return {e, walkTo, walkBack, evStart, evEnd, ...check({freeFrom, classStart, evStart, evEnd, stay, buffer, walkTo, walkBack})};
  }).sort((a, b) => (b.ok - a.ok) || ((a.join ?? a.evStart) - (b.join ?? b.evStart)));
  draw(o, d);
}

function visible() {
  return results.filter(r => (r.ok || state.showAll)
    && (!state.cats.size || r.e.cats.some(c => state.cats.has(c)))
    && (!state.free || r.e.free));
}

function pin(cls, text, size) {
  return L.divIcon({className: '', iconSize: [size, size], html: `<div class="pin ${cls}" style="width:${size}px;height:${size}px">${text}</div>`});
}

// A and B can be dragged; on release they snap to the nearest building and the plan is recomputed
function endpoint(field, id, icon, label) {
  const b = buildings[id];
  L.marker([b.lat, b.lon], {icon, draggable: true, zIndexOffset: 1000}).bindTooltip(label + b.name)
    .on('dragend', ev => {
      const near = nearestBuilding(ev.target.getLatLng());
      if (near) setField(field, near);
      setTimeout(() => draw(...ids()), 0);   // not found: snap back to where it was
    }).addTo(markerLayer);
}

function nearestBuilding(latlng) {
  let best = null, bestD = Infinity;
  Object.entries(buildings).forEach(([id, b]) => {
    const dist = map.distance(latlng, [b.lat, b.lon]);
    if (dist < bestD) { best = id; bestD = dist; }
  });
  return bestD <= 120 ? best : null;
}

function setField(field, id) {
  $(field).value = Object.keys(labelToId).find(l => labelToId[l] === id);
  state.selected = null;
  save(); compute();
}

function draw(o, d) {
  const shown = visible();
  // categories (only those that appear among the events that pass the time check)
  const count = {};
  results.filter(r => r.ok || state.showAll).forEach(r => r.e.cats.forEach(c => count[c] = (count[c] || 0) + 1));
  $('cats').innerHTML = Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 10).map(c =>
    `<button type="button" class="chip${state.cats.has(c) ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}<span class="n">${count[c]}</span></button>`).join('');

  const okCount = shown.filter(r => r.ok).length;
  $('count').textContent = o && d ? `${okCount} event${okCount === 1 ? '' : 's'} you can make` : '';
  $('list').innerHTML = shown.length ? shown.map((r, i) => {
    const e = r.e;
    const until = r.evEnd >= 1440 ? 'multi-day' : 'until ' + fmtTime(r.evEnd);
    return `<div class="card${r.ok ? '' : ' no'}${state.selected === e.key ? ' sel' : ''}" data-i="${i}">
      <div class="when">${fmtTime(r.evStart)}</div>
      <div class="body">
        <a class="title" href="${esc(e.alias)}" target="_blank">${esc(e.title)}</a>
        <div class="meta">${esc(e.locations || e.venue_address)} &middot; ${until}</div>
        <div class="walk">${r.ok
          ? `${mins(r.walkTo)} min walk there &middot; <span class="slack">${Math.floor(r.slack)} min to spare</span>`
          : `<span class="why">${esc(r.why)}</span>`}</div>
        ${e.free ? '<span class="badge free">Free</span>' : ''}${e.cats.slice(0, 2).map(c => `<span class="badge">${esc(c)}</span>`).join('')}
      </div>
      ${e.image_url ? `<img class="thumb" src="${esc(e.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    </div>`;
  }).join('') : `<div class="empty">${o && d ? 'No events fit this gap. Try a longer gap, a shorter stay, or another day.' : 'Pick where you are and where your next class is.'}</div>`;

  markerLayer.clearLayers();
  const byB = {};
  shown.forEach(r => (byB[r.e.building_id] = byB[r.e.building_id] || []).push(r));
  Object.entries(byB).forEach(([id, rs]) => {
    const b = buildings[id];
    if (!b) return;
    const ok = rs.some(r => r.ok);
    L.marker([b.lat, b.lon], {icon: pin(ok ? '' : 'off', rs.length, 26)})
      .bindPopup(`<b>${esc(b.name)}</b><br>${rs.map(r => `${fmtTime(r.evStart)} ${esc(r.e.title)}`).join('<br>')}`, {maxWidth: 260}).addTo(markerLayer);
  });
  if (o && buildings[o]) endpoint('origin', o, pin('start', 'A', 28), 'You are here: ');
  if (d && buildings[d]) endpoint('dest', d, pin('dest', 'B', 28), 'Next class: ');

  const pts = [o, d, ...Object.keys(byB)].filter(id => buildings[id]).map(id => [buildings[id].lat, buildings[id].lon]);
  if (pts.length > 1 && !state.selected) map.fitBounds(pts, {padding: [50, 50], maxZoom: 17});
}

// Walking route A -> event -> B on the real walkway network (loaded the first time you pick an event)
let netPromise = null;
function loadNetwork() {
  netPromise = netPromise || Promise.all([
    fetch('../data/walk_network.geojson').then(r => r.json()),
    fetch('../data/building_snaps.json').then(r => r.json())])
    .then(([geo, snaps]) => ({graph: Router.build(geo), snaps}));
  return netPromise;
}

async function showRoute(r) {
  routeLayer.clearLayers();
  const oId = buildingId($('origin').value), dId = buildingId($('dest').value), bId = r.e.building_id;
  const bounds = [oId, bId, dId].map(id => buildings[id]).filter(Boolean).map(b => [b.lat, b.lon]);
  try {
    const {graph, snaps} = await loadNetwork();
    if (state.selected !== r.e.key) return;   // picked something else while loading
    const at = id => [snaps[id].lon, snaps[id].lat];
    const there = Router.path(graph, at(oId), at(bId)), back = Router.path(graph, at(bId), at(dId));
    if (!there || !back) throw new Error('no route');
    L.polyline(there.coords, {color: '#1F5C5A', weight: 5, opacity: .9}).bindTooltip('To the event').addTo(routeLayer);
    L.polyline(back.coords, {color: '#D9774E', weight: 5, opacity: .9}).bindTooltip('To class').addTo(routeLayer);
    map.fitBounds(L.latLngBounds([...there.coords, ...back.coords]), {padding: [60, 60], maxZoom: 17});
  } catch (err) {
    // fall back to straight lines so something still shows
    L.polyline(bounds, {color: '#1F5C5A', weight: 3, dashArray: '6 8'}).addTo(routeLayer);
    map.fitBounds(bounds, {padding: [60, 60], maxZoom: 17});
  }
}

async function init() {
  const [geo, csv, mat] = await Promise.all([
    fetch('../data/buildings.geojson').then(r => r.json()),
    fetch('../data/event_buildings.csv').then(r => r.text()),
    fetch('../data/walk_matrix.json').then(r => r.json())]);
  matrix = mat;
  geo.features.forEach(f => {
    const p = f.properties;
    if (!matrix[p.building_id]) return;   // no walking times for this building
    buildings[p.building_id] = {name: p.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1]};
    labelToId[`${p.name} (${p.building_id})`] = p.building_id;
  });
  $('buildings').innerHTML = Object.keys(labelToId).sort().map(l => `<option value="${esc(l)}">`).join('');

  const bid = {};
  parseCsv(csv).forEach(r => { if (r.building_id) bid[r.nid + '|' + r.start] = r.building_id; });
  events = EVENTS.map(e => {
    const topics = String(e.event_topics || '').split('|').filter(Boolean);
    const cats = topics.filter(t => !NOT_CATEGORY.includes(t));
    return {...e, cats: cats.length ? cats : ['Other'], free: topics.includes('Free'),
            building_id: bid[e.nid + '|' + e.start] || null, key: e.nid + '|' + e.start};
  });

  $('day').value = new Date().toLocaleDateString('en-CA');
  restore();
  setNow();
  compute();
}

$('plan').addEventListener('input', () => { state.selected = null; save(); compute(); });
$('plan').addEventListener('submit', e => e.preventDefault());
$('free').addEventListener('change', e => { state.free = e.target.checked; draw(...ids()); });
$('show-all').addEventListener('change', e => { state.showAll = e.target.checked; draw(...ids()); });
$('cats').addEventListener('click', e => {
  const c = e.target.closest('[data-cat]')?.dataset.cat;
  if (!c) return;
  state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c);
  draw(...ids());
});
$('list').addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const card = e.target.closest('.card');
  if (!card) return;
  const r = visible()[card.dataset.i];
  state.selected = r.e.key;
  document.querySelectorAll('.card.sel').forEach(c => c.classList.remove('sel'));
  card.classList.add('sel');
  if (r.ok) showRoute(r);
});
// click the map to fill whichever of A / B is still empty (once both are set, drag the pins instead)
map.on('click', ev => {
  const best = nearestBuilding(ev.latlng);
  if (!best) return;
  const [o, d] = ids();
  if (!o) setField('origin', best);
  else if (!d) setField('dest', best);
});
const hint = L.control({position: 'bottomleft'});
hint.onAdd = () => L.DomUtil.create('div', 'map-hint');
hint.addTo(map);
hint.getContainer().textContent = 'Drag A or B to move them';
function ids() { return [buildingId($('origin').value), buildingId($('dest').value)]; }

init().catch(err => {
  $('gap-msg').textContent = 'Could not load data (' + err.message + '). Serve the repo with: python3 -m http.server';
  $('gap-msg').className = 'err';
});
