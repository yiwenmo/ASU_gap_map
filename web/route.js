// Shortest walking route on data/walk_network.geojson (the same network that made walk_matrix.json).
// Router.build(geojson) -> graph; Router.path(graph, [lon, lat], [lon, lat]) -> {coords: [[lat, lon], ...], meters}
// Both points should sit on the network (use building_snaps.json); each one is attached to its nearest segment.

const Router = (() => {
  const M_LAT = 110540, M_LON = 111320 * Math.cos(33.42 * Math.PI / 180);   // meters per degree around Tempe
  const dist = (a, b) => Math.hypot((a[0] - b[0]) * M_LON, (a[1] - b[1]) * M_LAT);

  function build(geo) {
    const ids = new Map(), pts = [], adj = [], segs = [];
    const node = p => {
      const k = p[0] + ',' + p[1];
      if (!ids.has(k)) { ids.set(k, pts.length); pts.push(p); adj.push([]); }
      return ids.get(k);
    };
    geo.features.forEach(f => {
      const c = f.geometry.coordinates;
      for (let i = 0; i < c.length - 1; i++) {
        const u = node(c[i]), v = node(c[i + 1]), w = dist(c[i], c[i + 1]);
        adj[u].push([v, w]); adj[v].push([u, w]);
        segs.push([u, v]);
      }
    });
    return {pts, adj, segs};
  }

  // closest point on any segment to p -> {u, v, point}
  function nearest(g, p) {
    let best = null, bd = Infinity;
    for (const [u, v] of g.segs) {
      const a = g.pts[u], b = g.pts[v];
      const ax = (b[0] - a[0]) * M_LON, ay = (b[1] - a[1]) * M_LAT;
      const len2 = ax * ax + ay * ay;
      const t = len2 ? Math.max(0, Math.min(1, (((p[0] - a[0]) * M_LON) * ax + ((p[1] - a[1]) * M_LAT) * ay) / len2)) : 0;
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const d = dist(p, q);
      if (d < bd) { bd = d; best = {u, v, point: q}; }
    }
    return best;
  }

  function path(g, from, to) {
    const n = g.pts.length, S = n, T = n + 1;   // two virtual nodes: start and end
    const a = nearest(g, from), b = nearest(g, to);
    const extra = {[S]: [[a.u, dist(a.point, g.pts[a.u])], [a.v, dist(a.point, g.pts[a.v])]],
                   [T]: [[b.u, dist(b.point, g.pts[b.u])], [b.v, dist(b.point, g.pts[b.v])]]};
    // reach T from its two segment ends
    const toT = new Map([[b.u, dist(b.point, g.pts[b.u])], [b.v, dist(b.point, g.pts[b.v])]]);
    const d = new Map([[S, 0]]), prev = new Map(), heap = [[0, S]];
    const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const relax = (u, v, w, du) => { if (du + w < (d.get(v) ?? Infinity)) { d.set(v, du + w); prev.set(v, u); push([du + w, v]); } };
    while (heap.length) {
      const [du, u] = pop();
      if (du > (d.get(u) ?? Infinity)) continue;
      if (u === T) break;
      (u === S ? extra[S] : g.adj[u]).forEach(([v, w]) => relax(u, v, w, du));
      if (toT.has(u)) relax(u, T, toT.get(u), du);
    }
    if (!d.has(T)) return null;
    const out = [];
    for (let u = T; u !== undefined; u = prev.get(u)) out.push(u === S ? a.point : u === T ? b.point : g.pts[u]);
    out.reverse();
    return {coords: out.map(p => [p[1], p[0]]), meters: d.get(T)};
  }

  return {build, path};
})();

if (typeof module !== 'undefined') module.exports = Router;
