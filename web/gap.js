// ASU Gap Map: which events can I walk to and still make my next class?
// Needs: EVENTS (events_data.js), data/buildings.geojson, data/event_buildings.csv, data/walk_matrix.json,
// and for drawing routes data/walk_network.geojson + data/building_snaps.json (route.js).
// fetch() does not work from file://, so serve the repo root: python3 -m http.server, then open /web/gap.html

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const $ = id => document.getElementById(id);
const NOT_CATEGORY = ['Free', 'Open to the public'];

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
// "Now" and "today" must be Arizona time, not the browser's. Someone opening the page from
// another time zone would otherwise get a wrong default time/day and a wrong gap check.
// Arizona has no daylight saving, so the offset never changes. (Added by Ziyi.)
const ASU_TIME_ZONE = 'America/Phoenix';
function getAsuTime() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: ASU_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date())
      .map(p => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

// Minutes from midnight of `day` (YYYY-MM-DD) to the event's time `iso` (YYYY-MM-DDTHH:MM).
// Can exceed 1440 when the event ends on a later day (exhibitions, multi-day events).
// The feed times are Arizona wall-clock with no offset, so this reads them as plain numbers
// and never goes through `new Date(...)`, which would use the browser's time zone.
// If the feed ever adds an offset ("-07:00" / "Z"), it is ignored here. (Added by Ziyi.)
function eventMinutes(iso, day) {
  const [date, time] = iso.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [dy, dm, dd] = day.split('-').map(Number);
  const dayDifference = (Date.UTC(y, m - 1, d) - Date.UTC(dy, dm - 1, dd)) / 60000;

  return dayDifference + toMin(time.slice(0, 5));
}

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
// Esri tiles (OSM tiles get blocked when opening from file://). A button in the corner switches between the street map
// and the satellite image (the satellite is useful to see a building that the street map does not show yet).
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const streetMap = L.tileLayer(ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, USGS, NGA, OpenStreetMap contributors'});
const satellite = L.layerGroup([
  L.tileLayer(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'}),
  L.tileLayer(ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {maxZoom: 19}),   // street and place names on top
]);
streetMap.addTo(map);
L.control.layers({'Map': streetMap, 'Satellite': satellite}, null, {position: 'topright', collapsed: false}).addTo(map);
const markerLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

let buildings = {};   // building_id -> {name, lat, lon}
let labelToId = {};   // datalist label -> building_id
let matrix = {};
let events = [];      // EVENTS joined with building_id
let results = [];     // last computed list
const state = {cats: new Set(), free: false, showAll: false, selected: null,
               stops: new Set(['coffee', 'food', 'study'])};   // which kinds of places to show on the way
let pois = [];        // coffee / food / study places, each next to a building (data/pois.geojson)

function buildingId(text) {
  const t = text.trim();
  if (labelToId[t]) return labelToId[t];
  const hit = Object.keys(labelToId).filter(l => l.toLowerCase() === t.toLowerCase());
  return hit.length ? labelToId[hit[0]] : (buildings[t.toUpperCase()] ? t.toUpperCase() : null);
}

// "I'm free at" starts as the current Arizona time (rounded up to 5 min), so most people never touch it
function setNow() {
  const m = Math.min(23 * 60 + 55, Math.ceil(getAsuTime().minutes / 5) * 5);
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

// Places that are on the way: a detour of at most DETOUR_MAX seconds, and it must fit in the time to spare.
// The walk is building to building, so a place counts as being at its building.
//   there: A -> place -> event        back: event -> place -> B
// detour = (A -> place) + (place -> event) - (A -> event)
const DETOUR_MAX = 120;
// Opening hours (format in pipeline/campus_dining.py): {"mon": [["07:30","21:00"]], "tue": [], "wed": null, ...}
// [] = closed all day, null = not known, a close time past 24:00 runs into the next morning.
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const clockMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function dayIndex(isoDay) { return (new Date(isoDay + 'T12:00:00').getDay() + 6) % 7; }   // Monday = 0
// true / false, or null when we do not know (no hours, or that day is "not known")
function isOpen(hours, dayIdx, min) {
  if (!hours) return null;
  const yesterday = hours[DAY_KEYS[(dayIdx + 6) % 7]];
  if (yesterday && yesterday.some(([, c]) => clockMin(c) > 1440 && min < clockMin(c) - 1440)) return true;
  const today = hours[DAY_KEYS[dayIdx]];
  if (today == null) return null;
  return today.some(([o, c]) => min >= clockMin(o) && min < clockMin(c));
}

// A building is one stop: {building_id, places: [...], detour}. The walk is building to building, so every place
// in a building has the same detour, and a food court with 9 places is one stop, not nine.
// Places inside the building of the event are left out (they are the event, not on the way).
// `leave` (minutes after midnight) is when you set off from `from`: a place that is closed when you get there is left out.
function stopsOn(from, to, slack, eventBuilding, leave, dayIdx) {
  const direct = matrix[from]?.[to];
  if (direct == null) return [];
  const groups = new Map();
  pois.forEach(p => {
    if (p.building_id === eventBuilding) return;
    // a study spot in the building you start from or are heading to is not a stop on the way
    if (p.category === 'study' && (p.building_id === from || p.building_id === to)) return;
    const a = matrix[from]?.[p.building_id], b = matrix[p.building_id]?.[to];
    if (a == null || b == null) return;
    const detour = Math.max(0, a + b - direct);
    if (detour > DETOUR_MAX || detour / 60 > slack) return;
    if (isOpen(p.hours, dayIdx, leave + a / 60) === false) return;   // known to be closed when you get there
    if (!groups.has(p.building_id)) groups.set(p.building_id, {building_id: p.building_id, places: [], detour});
    groups.get(p.building_id).places.push(p);
  });
  groups.forEach(g => g.places.sort((x, y) => x.name.localeCompare(y.name)));
  return [...groups.values()].sort((x, y) => x.detour - y.detour || y.places.length - x.places.length);
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
  const dayIdx = dayIndex(day);
  results = events.filter(e => e.date === day && e.building_id).map(e => {
    const evStart = toMin(e.start.slice(11, 16));
    // end can be on a later day (exhibitions, multi-day events), so count minutes from midnight of the chosen day
    const evEnd = e.end ? eventMinutes(e.end, day) : evStart + stay;
    const walkTo = matrix[o]?.[e.building_id], walkBack = matrix[e.building_id]?.[d];
    const c = check({freeFrom, classStart, evStart, evEnd, stay, buffer, walkTo, walkBack});
    const stops = c.ok ? {there: stopsOn(o, e.building_id, c.slack, e.building_id, freeFrom, dayIdx),
                          back: stopsOn(e.building_id, d, c.slack, e.building_id, c.join + Math.min(stay, evEnd - evStart), dayIdx)}
                       : {there: [], back: []};
    return {e, walkTo, walkBack, evStart, evEnd, stops, ...c};
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

// Under an event card, the places on the way, in the same two forms as the page uses elsewhere:
//   not selected: one quiet line, the buildings only ("On the way: Memorial Union, Armstrong Hall +2")
//   selected:     a short list, "Before the event" and "After the event", building by building with the names
// Only the kinds switched on count. (CSS shows one or the other, depending on .sel.)
// A place is listed under its building, so its name should not repeat the building:
// "Hayden Library" in Hayden Library -> "Study space", "Hayden Library Concourse" -> "Concourse".
function placeName(p, buildingName) {
  const n = p.name.trim(), b = (buildingName || '').trim().toLowerCase();
  if (b && n.toLowerCase() === b) return {coffee: 'Coffee', food: 'Food', study: 'Study space'}[p.category] || n;
  if (b && n.toLowerCase().startsWith(b + ' ')) return n.slice(b.length).trim();
  return n;
}
function stopsOf(list) {
  return list.map(g => ({...g, places: g.places.filter(p => state.stops.has(p.category))})).filter(g => g.places.length);
}
// A plain link, no key and no Google data kept: it opens Google Maps with walking directions from where the person is now.
// The destination is the building's point, Google picks the way in.
function gmapsLink(e) {
  const b = buildings[e.building_id];
  if (!b) return '';
  return `<a class="gmaps" href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=walking" target="_blank" rel="noopener">Walking directions in Google Maps &#8599;</a>`;
}
function stopsHtml(r) {
  if (!r.ok) return '';
  const there = stopsOf(r.stops.there), back = stopsOf(r.stops.back);
  if (!there.length && !back.length) return '';
  const nameOf = g => buildings[g.building_id]?.name || g.building_id;
  const seen = new Set();
  const all = [...there, ...back].filter(g => !seen.has(g.building_id) && seen.add(g.building_id));
  const summary = `On the way: ${all.slice(0, 2).map(g => esc(nameOf(g))).join(', ')}${all.length > 2 ? ` +${all.length - 2}` : ''}`;
  const part = (title, list) => !list.length ? '' : `<div class="onway-h">${title}</div>` + list.slice(0, 4).map(g => {
    const m = Math.round(g.detour / 60);
    const names = g.places.slice(0, 3).map(p => esc(placeName(p, nameOf(g)))).join(', ') + (g.places.length > 3 ? ` +${g.places.length - 3}` : '');
    return `<div class="onway-row"><b>${esc(nameOf(g))}</b><span>${names}</span>${m ? `<em>+${m} min</em>` : ''}</div>`;
  }).join('');
  return `<div class="onway-summary">${summary}</div>
    <div class="onway-detail">${part('Before the event', there)}${part('After the event', back)}</div>`;
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
        ${stopsHtml(r)}
        ${r.ok ? gmapsLink(e) : ''}
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
  const seenB = new Set();
  [...stopsOf(r.stops.there), ...stopsOf(r.stops.back)].filter(g => !seenB.has(g.building_id) && seenB.add(g.building_id)).slice(0, 12).forEach(g => {
    const n = g.places.length;
    const lat = g.places.reduce((t, p) => t + p.lat, 0) / n, lon = g.places.reduce((t, p) => t + p.lon, 0) / n;
    const kinds = new Set(g.places.map(p => p.category));
    const kind = kinds.size === 1 ? [...kinds][0] : 'mixed';
    const size = n > 1 ? 22 : 18;
    const bn = buildings[g.building_id]?.name || '';
    const names = g.places.slice(0, 8).map(p => esc(placeName(p, bn))).join('<br>') + (n > 8 ? `<br>+${n - 8} more` : '');
    L.marker([lat, lon], {icon: L.divIcon({className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: `<div class="amenity-pin ${kind}${n > 1 ? ' count' : ''}">${n > 1 ? n : ''}</div>`})})
      .bindPopup(`<b>${esc(buildings[g.building_id]?.name || '')}</b><br>${names}`)
      .addTo(routeLayer);
  });
  try {
    const {graph, snaps} = await loadNetwork();
    if (state.selected !== r.e.key) return;   // picked something else while loading
    const at = id => [snaps[id].lon, snaps[id].lat];
    const there = Router.path(graph, at(oId), at(bId)), back = Router.path(graph, at(bId), at(dId));
    if (!there || !back) throw new Error('no route');
    L.polyline(there.coords, {color: '#8C1D40', weight: 5, opacity: .9}).bindTooltip('To the event').addTo(routeLayer);
    L.polyline(back.coords, {color: '#E0A100', weight: 5, opacity: .9}).bindTooltip('To class').addTo(routeLayer);
    map.fitBounds(L.latLngBounds([...there.coords, ...back.coords]), {padding: [60, 60], maxZoom: 17});
  } catch (err) {
    // fall back to straight lines so something still shows
    L.polyline(bounds, {color: '#8C1D40', weight: 3, dashArray: '6 8'}).addTo(routeLayer);
    map.fitBounds(bounds, {padding: [60, 60], maxZoom: 17});
  }
}

async function init() {
  const [geo, csv, mat, poiGeo] = await Promise.all([
    fetch('../data/buildings.geojson').then(r => r.json()),
    fetch('../data/event_buildings.csv').then(r => r.text()),
    fetch('../data/walk_matrix.json').then(r => r.json()),
    // the places are a bonus: if the file is missing the page still plans events
    fetch('../data/pois.geojson').then(r => r.json()).catch(() => ({features: []}))]);
  matrix = mat;
  // The list offers each building's name plus its other names ("Grady Gammage"), shown as plain names.
  // The code ("GGMA") and the Facilities number ("001") mean nothing to a student, so they are not listed.
  // Typing a code like GGMA still works, see buildingId(). Names that differ only in capital letters count
  // as one. If two different buildings ever share a name, the code is added after it so they stay apart.
  const entries = [];   // [label, building_id]
  geo.features.forEach(f => {
    const p = f.properties;
    if (!matrix[p.building_id]) return;   // no walking times for this building
    buildings[p.building_id] = {name: p.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1]};
    const skip = new Set([p.building_id, ...(p.bldg_numbers || [])].map(s => s.toLowerCase()));
    const seen = new Set();
    [p.name, ...(p.aliases || [])].forEach(label => {
      const key = label.toLowerCase();
      if (skip.has(key) || seen.has(key)) return;
      seen.add(key);
      entries.push([label, p.building_id]);
    });
  });
  const owners = {};   // lower-case name -> number of buildings that use it
  entries.forEach(([label]) => { owners[label.toLowerCase()] = (owners[label.toLowerCase()] || 0) + 1; });
  entries.forEach(([label, id]) => {
    labelToId[owners[label.toLowerCase()] > 1 ? `${label} (${id})` : label] = id;
  });
  $('buildings').innerHTML = Object.keys(labelToId).sort().map(l => `<option value="${esc(l)}">`).join('');

  pois = poiGeo.features.filter(f => f.properties?.building_id && matrix[f.properties.building_id]
      && ['coffee', 'food', 'study'].includes(f.properties.category))
    .map(f => ({...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
                building_name: buildings[f.properties.building_id]?.name}));

  // a kind with no places has no use as a switch: hide its chip (it comes back when there are places)
  document.querySelectorAll('#stops [data-stop]').forEach(chip => {
    if (!pois.some(p => p.category === chip.dataset.stop)) { chip.style.display = 'none'; state.stops.delete(chip.dataset.stop); }
  });

  const bid = {};
  parseCsv(csv).forEach(r => { if (r.building_id) bid[r.nid + '|' + r.start] = r.building_id; });
  events = EVENTS.map(e => {
    const topics = String(e.event_topics || '').split('|').filter(Boolean);
    const cats = topics.filter(t => !NOT_CATEGORY.includes(t));
    return {...e, cats: cats.length ? cats : ['Other'], free: topics.includes('Free'),
            building_id: bid[e.nid + '|' + e.start] || null, key: e.nid + '|' + e.start};
  });

  // default day = today in Arizona (not the browser's local date)
  $('day').value = getAsuTime().date;
  restore();
  setNow();
  compute();
}

$('plan').addEventListener('input', () => { state.selected = null; save(); compute(); });
$('plan').addEventListener('submit', e => e.preventDefault());
$('free').addEventListener('change', e => { state.free = e.target.checked; draw(...ids()); });
$('show-all').addEventListener('change', e => { state.showAll = e.target.checked; draw(...ids()); });
$('stops').addEventListener('click', e => {
  const k = e.target.closest('[data-stop]')?.dataset.stop;
  if (!k) return;
  state.stops.has(k) ? state.stops.delete(k) : state.stops.add(k);
  e.target.closest('[data-stop]').classList.toggle('on', state.stops.has(k));
  draw(...ids());
  const sel = results.find(r => r.e.key === state.selected);
  if (sel && sel.ok) showRoute(sel);   // redraw the places on the map for the selected event
});
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
