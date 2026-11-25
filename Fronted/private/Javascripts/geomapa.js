'use strict';
/* RIM · GeoMapa — Leaflet 1.9.4 · Chrome 109 / Firefox 115
   Niveles: provincia (municipios + troncales) → municipio (editor geo de unidades)
   El interior de cada unidad se gestiona en topologia.html (editor clásico). */

var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); }
function safe(fn, tag) { try { fn(); } catch (e) { console.error('[GeoMapa] ' + tag, e); } }

var KEY_CAPA = 'rim.geomapa.capa.v1';
var Z_MUNI = 11, Z_DETAIL = 14;
var FILL = 0.10, WLINE = 3, SEP = 14;
var VEL = ['100 Mbps', '1 Gbps', '10 Gbps', '40 Gbps', '100 Gbps'];
var ICO = { unidad: '🏢', edificio: '🏬', local: '🚪', switch: '🔀', modem: '📶', transceiver: '🔌', servidor: '💻', firewall: '🛡️', dns: '🌐', bd: '🗄️', pc: '🖥️' };
var C = { ok: '#21c063', warn: '#f39c12', bad: '#e74c3c', idle: '#95a5a6', fo: '#ff9f1c', eth: '#70e000' };

var CAPA = { locks: {}, pos: {}, curvas: {} };
var S = { rol: 'operador', usuario: '', munis: [], geo: [], topos: {}, estados: {}, globales: [], foco: { nivel: 'provincia', mun: null }, sel: null, connSel: null, modo: null, undo: null, arrastrando: false };
var GEO = {}, HIJOS = {}, PADRE = {}, MUN_DE = {}, OBJ = {};
var map, lMuni, lInter, lCont, lEq, lIntra, lPort, lHand, lMask = null;
var REF = { cont: {}, eq: {}, lines: {}, con: {}, hits: {} };
var arrancado = false;
var desgloseActual = [];

/* ================= FASE 1: capa persistida en servidor ================= */
var CAPA_SYNC = { locks: {}, pos: {}, curvas: {} };
var syncTimer = null, syncEnCurso = false, syncPendiente = false, syncFalloAvisado = false;

function loadCapa() {
    try {
        var k = JSON.parse(localStorage.getItem(KEY_CAPA) || 'null');
        if (k) CAPA = { locks: k.locks || {}, pos: k.pos || {}, curvas: k.curvas || {} };
    } catch (e) { }
}
function cacheLocal() { try { localStorage.setItem(KEY_CAPA, JSON.stringify(CAPA)); } catch (e) { } }

function saveCapa() {
    cacheLocal();
    if (!puedeEditar()) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { safe(enviarDeltas, 'sync'); }, 450);
}

function idsEnlaces() {
    var s = {};
    Object.keys(S.topos).forEach(function (m) {
        ((S.topos[m] || {}).conexiones || []).forEach(function (c) { s[c.id] = 1; });
    });
    S.globales.forEach(function (g) { s[g.id] = 1; });
    Object.keys(CAPA.curvas).forEach(function (k) { s[k] = 1; });
    Object.keys(CAPA_SYNC.curvas).forEach(function (k) { s[k] = 1; });
    return s;
}
function fnum(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(7) : ''; }
function firmaObj(c, id) { var p = c.pos[id]; return (c.locks[id] ? 1 : 0) + '|' + (p ? fnum(p[0]) + ',' + fnum(p[1]) : ''); }
function firmaEn(c, id) {
    var a = c.curvas[id] || [];
    return (c.locks[id] ? 1 : 0) + '|' + a.map(function (p) { return fnum(p[0]) + ',' + fnum(p[1]); }).join(';');
}

async function enviarDeltas() {
    if (!puedeEditar()) return;
    if (syncEnCurso) { syncPendiente = true; return; }
    syncEnCurso = true;
    var trabajos = [], en = idsEnlaces();

    try {
        var idsObj = {}, idsEn = {};
        Object.keys(CAPA.locks).forEach(function (k) { (en[k] ? idsEn : idsObj)[k] = 1; });
        Object.keys(CAPA_SYNC.locks).forEach(function (k) { (en[k] ? idsEn : idsObj)[k] = 1; });
        Object.keys(CAPA.pos).forEach(function (k) { idsObj[k] = 1; });
        Object.keys(CAPA_SYNC.pos).forEach(function (k) { idsObj[k] = 1; });
        Object.keys(CAPA.curvas).forEach(function (k) { idsEn[k] = 1; });
        Object.keys(CAPA_SYNC.curvas).forEach(function (k) { idsEn[k] = 1; });

        Object.keys(idsObj).forEach(function (id) {
            if (firmaObj(CAPA, id) === firmaObj(CAPA_SYNC, id)) return;
            var p = CAPA.pos[id];
            var estado = { locked: !!CAPA.locks[id], lat: p ? p[0] : null, lon: p ? p[1] : null };
            trabajos.push(api('/api/geo/objeto/' + encodeURIComponent(id), {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(estado)
            }).then(function () {
                if (estado.locked) CAPA_SYNC.locks[id] = true; else delete CAPA_SYNC.locks[id];
                if (p) CAPA_SYNC.pos[id] = p.slice(); else delete CAPA_SYNC.pos[id];
            }));
        });

        Object.keys(idsEn).forEach(function (id) {
            if (firmaEn(CAPA, id) === firmaEn(CAPA_SYNC, id)) return;
            var pts = CAPA.curvas[id] || [];
            var estado = { locked: !!CAPA.locks[id], puntos: pts };
            trabajos.push(api('/api/geo/enlace/' + encodeURIComponent(id), {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(estado)
            }).then(function () {
                if (estado.locked) CAPA_SYNC.locks[id] = true; else delete CAPA_SYNC.locks[id];
                if (pts.length) CAPA_SYNC.curvas[id] = pts.slice(); else delete CAPA_SYNC.curvas[id];
            }));
        });

        if (trabajos.length) { await Promise.all(trabajos); cacheLocal(); }
        syncFalloAvisado = false;
    } catch (e) {
        console.warn('[GEO] No se pudo sincronizar la capa:', e.message);
        if (!syncFalloAvisado) {
            syncFalloAvisado = true;
            toast('warn', '☁️', 'Cambios guardados solo localmente. Reintentando…');
        }
        setTimeout(function () { safe(enviarDeltas, 'resync'); }, 8000);
    } finally {
        syncEnCurso = false;
        if (syncPendiente) { syncPendiente = false; setTimeout(function () { safe(enviarDeltas, 'sync'); }, 300); }
    }
}

async function syncCapa() {
    var remota;
    try { remota = await api('/api/geo/capa'); }
    catch (e) {
        console.warn('[GEO] Sin capa remota, usando caché local:', e.message);
        CAPA_SYNC = JSON.parse(JSON.stringify(CAPA));
        return;
    }
    var hayRemoto = Object.keys(remota.locks || {}).length || Object.keys(remota.pos || {}).length || Object.keys(remota.curvas || {}).length;
    var hayLocal = Object.keys(CAPA.locks).length || Object.keys(CAPA.pos).length || Object.keys(CAPA.curvas).length;
    if (!hayRemoto && hayLocal && puedeEditar()) {
        try {
            var r = await api('/api/geo/migrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CAPA) });
            CAPA_SYNC = JSON.parse(JSON.stringify(CAPA));
            toast('ok', '☁️', 'Capa migrada al servidor: ' + r.objetos + ' objeto(s), ' + r.enlaces + ' enlace(s)');
            return;
        } catch (e) { console.warn('[GEO] Migración falló:', e.message); }
    }
    CAPA = { locks: remota.locks || {}, pos: remota.pos || {}, curvas: remota.curvas || {} };
    CAPA_SYNC = JSON.parse(JSON.stringify(CAPA));
    cacheLocal();
}

window.RIMcapa = function () {
    fetch('/api/geo/estado', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
        console.log('Capa en servidor:', d);
        console.log('Capa en memoria:', CAPA);
    });
};

/* ================= dominio ================= */
function esCont(t) { return t === 'unidad' || t === 'edificio' || t === 'local'; }
function esEq(t) { return t === 'switch' || t === 'modem' || t === 'transceiver'; }
function esServicio(t) { return t === 'bd' || t === 'dns' || t === 'firewall' || t === 'servidor'; }
function esHoja(t) { return esEq(t) || esServicio(t) || t === 'pc'; }
function hijosDe(o) {
    if (!o) return [];
    if (o.tipo === 'unidad') return o.edificios || [];
    if (o.tipo === 'edificio') return o.locales || [];
    if (o.tipo === 'local') return [].concat(o.sublocales || [], o.equipos || [], o.servicios || [], o.pcs || []);
    return [];
}
function nombreDe(o) { return o ? (o.descripcion || o.nombre || o.id) : '?'; }
function estadoDe(id) { var e = S.estados[id]; return e ? e.estado : 'desconocido'; }
function colorDe(id) { var e = estadoDe(id); return e === 'online' ? C.ok : e === 'offline' ? C.bad : e === 'degradado' ? C.warn : C.idle; }
function locked(id) { return !!CAPA.locks[id]; }
function puedeEditar() { return S.rol === 'admin' || S.rol === 'superadmin'; }
function puedeTocar(id) { return puedeEditar() && !locked(id); }
function collectEq(o, out) {
    out = out || [];
    [].concat(o.equipos || [], o.servicios || [], o.pcs || []).forEach(function (x) { out.push(x); });
    [].concat(o.edificios || [], o.locales || [], o.sublocales || []).forEach(function (h) { collectEq(h, out); });
    return out;
}
function redDeMun(mid) { var t = S.topos[mid], a = []; if (t) (t.unidades || []).forEach(function (u) { collectEq(u).forEach(function (x) { if (esEq(x.tipo)) a.push(x); }); }); return a; }
function contar(topo) { var c = { switch: 0, modem: 0, transceiver: 0, total: 0 }; if (!topo) return c; (topo.unidades || []).forEach(function (u) { collectEq(u).forEach(function (e) { if (c[e.tipo] != null) c[e.tipo]++; c.total++; }); }); return c; }
function estadosMun(mid) {
    var t = S.topos[mid], r = { online: 0, offline: 0, degradado: 0, desconocido: 0 };
    if (!t) return r;
    (t.unidades || []).forEach(function (u) { collectEq(u).forEach(function (e) { if (!e.ip || e.monitoreo === 'ninguno') return; var s = estadoDe(e.id); if (r[s] != null) r[s]++; else r.desconocido++; }); });
    return r;
}
function unidadConCaidas(u) {
    var eqs = collectEq(u);
    for (var i = 0; i < eqs.length; i++) if (estadoDe(eqs[i].id) === 'offline') return true;
    return false;
}

/* ---------- geometría ---------- */
function bboxNivel(a) {
    var r = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    a.forEach(function (o) { var x = o.x || 0, y = o.y || 0; r.minX = Math.min(r.minX, x); r.maxX = Math.max(r.maxX, x + (o.width || 80)); r.minY = Math.min(r.minY, y); r.maxY = Math.max(r.maxY, y + (o.height || 80)); });
    if (!isFinite(r.minX)) r = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    r.w = Math.max(1, r.maxX - r.minX); r.h = Math.max(1, r.maxY - r.minY); return r;
}
function deltaContencion(r, p) {
    var dln = 0, dla = 0;
    var rw = r.getEast() - r.getWest(), rh = r.getNorth() - r.getSouth();
    var pw = p.getEast() - p.getWest(), ph = p.getNorth() - p.getSouth();
    if (rw >= pw) dln = p.getCenter().lng - r.getCenter().lng;
    else if (r.getWest() < p.getWest()) dln = p.getWest() - r.getWest();
    else if (r.getEast() > p.getEast()) dln = p.getEast() - r.getEast();
    if (rh >= ph) dla = p.getCenter().lat - r.getCenter().lat;
    else if (r.getSouth() < p.getSouth()) dla = p.getSouth() - r.getSouth();
    else if (r.getNorth() > p.getNorth()) dla = p.getNorth() - r.getNorth();
    return [dla, dln];
}
function clampPunto(ll, p) {
    if (!p) return ll;
    return L.latLng(clamp(ll.lat, p.getSouth(), p.getNorth()), clamp(ll.lng, p.getWest(), p.getEast()));
}
function clampCentro(rect, centro, limite) {
    if (!rect || !limite) return centro;
    var hw = (rect.getEast() - rect.getWest()) / 2, hh = (rect.getNorth() - rect.getSouth()) / 2;
    var minLng = limite.getWest() + hw, maxLng = limite.getEast() - hw;
    var minLat = limite.getSouth() + hh, maxLat = limite.getNorth() - hh;
    return L.latLng(
        minLat > maxLat ? limite.getCenter().lat : clamp(centro.lat, minLat, maxLat),
        minLng > maxLng ? limite.getCenter().lng : clamp(centro.lng, minLng, maxLng)
    );
}
function limiteDeMunicipio(mid) {
    var m = geoDe(mid);
    return m ? m.bounds.pad(-0.02) : null;
}

function layout(arr, rect, mid) {
    if (!arr.length) return;
    var inner = rect.pad(-0.10);
    var bb = bboxNivel(arr);
    var W = inner.getEast() - inner.getWest(), H = inner.getNorth() - inner.getSouth();
    if (W <= 0 || H <= 0) return;
    var sx = W / bb.w, sy = H / bb.h;
    arr.forEach(function (o) {
        var ox = (o.x || 0) - bb.minX, oy = (o.y || 0) - bb.minY;
        var ow = (o.width || 80), oh = (o.height || 80);
        var west = inner.getWest() + ox * sx;
        var east = west + ow * sx;
        var north = inner.getNorth() - oy * sy;
        var south = north - oh * sy;
        var childRect = L.latLngBounds([south, west], [north, east]);
        var cen = childRect.getCenter();
        GEO[o.id] = { lat: cen.lat, lng: cen.lng, mun: mid };
        MUN_DE[o.id] = mid; OBJ[o.id] = o;
        HIJOS[o.id] = hijosDe(o).map(function (x) { return x.id; });
        hijosDe(o).forEach(function (x) { PADRE[x.id] = o.id; });
        if (esCont(o.tipo)) { GEO[o.id].rect = childRect; layout(hijosDe(o), childRect, mid); }
    });
}

function construirGeo() {
    GEO = {}; HIJOS = {}; PADRE = {}; MUN_DE = {}; OBJ = {};
    S.geo.forEach(function (m) { var t = S.topos[m.id]; if (t) layout(t.unidades || [], m.bounds, m.id); });
    var aplicar = function (id, limite) {
        var g = GEO[id]; if (!g) return;
        if (CAPA.pos[id]) moverSub(id, CAPA.pos[id][0] - g.lat, CAPA.pos[id][1] - g.lng);
        if (limite) {
            if (g.rect) {
                var d = deltaContencion(g.rect, limite);
                if (d[0] || d[1]) moverSub(id, d[0], d[1]);
            } else {
                var c = clampPunto(L.latLng(g.lat, g.lng), limite);
                if (c.lat !== g.lat || c.lng !== g.lng) moverSub(id, c.lat - g.lat, c.lng - g.lng);
            }
        }
        var miLimite = g.rect ? g.rect.pad(-0.05) : limite;
        (HIJOS[id] || []).forEach(function (h) { aplicar(h, miLimite); });
    };
    S.geo.forEach(function (m) {
        var t = S.topos[m.id]; if (!t) return;
        (t.unidades || []).forEach(function (u) { aplicar(u.id, m.bounds.pad(-0.02)); });
    });
}
function moverSub(id, dla, dln) {
    var g = GEO[id]; if (!g) return;
    g.lat += dla; g.lng += dln;
    if (g.rect) g.rect = L.latLngBounds([g.rect.getSouth() + dla, g.rect.getWest() + dln], [g.rect.getNorth() + dla, g.rect.getEast() + dln]);
    (HIJOS[id] || []).forEach(function (h) { moverSub(h, dla, dln); });
}
function posLL(id) { var g = GEO[id]; return g ? L.latLng(g.lat, g.lng) : null; }
function unidadesDe(mid) { var t = S.topos[mid]; return t ? (t.unidades || []) : []; }
function dentroDe(a, id) { var h = HIJOS[a] || []; for (var i = 0; i < h.length; i++) if (h[i] === id || dentroDe(h[i], id)) return true; return false; }
function representante(id) {
    var us = unidadesDe(S.foco.mun), i;
    for (i = 0; i < us.length; i++) if (us[i].id === id) return us[i];
    for (i = 0; i < us.length; i++) if (dentroDe(us[i].id, id)) return us[i];
    return null;
}

/* ---------- curvas ---------- */
function spline(pts, seg) {
    if (pts.length < 3) return pts;
    var P = [pts[0]].concat(pts, [pts[pts.length - 1]]), out = [];
    for (var i = 0; i < P.length - 3; i++) {
        var p0 = P[i], p1 = P[i + 1], p2 = P[i + 2], p3 = P[i + 3];
        for (var t = 0; t < seg; t++) {
            var s = t / seg, s2 = s * s, s3 = s2 * s;
            out.push(L.latLng(
                .5 * (2 * p1.lat + (-p0.lat + p2.lat) * s + (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * s2 + (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * s3),
                .5 * (2 * p1.lng + (-p0.lng + p2.lng) * s + (2 * p0.lng - 5 * p1.lng + 4 * p2.lng - p3.lng) * s2 + (-p0.lng + 3 * p1.lng - 3 * p2.lng + p3.lng) * s3)));
        }
    }
    out.push(pts[pts.length - 1]); return out;
}
function trazo(c, a, b, idx, n) {
    var man = CAPA.curvas[c.id], pts = [a];
    if (man && man.length) man.forEach(function (p) { pts.push(L.latLng(p[0], p[1])); });
    else if (n > 1) {
        var pa = map.latLngToLayerPoint(a), pb = map.latLngToLayerPoint(b);
        var dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var off = (idx - (n - 1) / 2) * SEP;
        pts.push(map.layerPointToLatLng(L.point((pa.x + pb.x) / 2 - dy / len * off, (pa.y + pb.y) / 2 + dx / len * off)));
    }
    pts.push(b); return spline(pts, 14);
}
function infoCon(c) {
    var a = estadoDe(c.desde), b = estadoDe(c.hasta);
    var caido = a === 'offline' || b === 'offline', deg = !caido && (a === 'degradado' || b === 'degradado');
    return { caido: caido, deg: deg, color: caido ? C.bad : deg ? C.warn : (c.tipo === 'FO' ? C.fo : C.eth), dash: caido ? '5 7' : deg ? '11 6' : '10 14' };
}
function tipCon(c, na, nb) {
    var i = infoCon(c);
    return '<div class="tt-h">' + (c.inter ? 'Enlace inter-municipio' : 'Enlace interno') + '</div>' +
        '<div class="tt-r"><b>' + esc(na) + '</b>' + (c.puertoDesde != null ? ' <span class="tt-p">· puerto ' + c.puertoDesde + '</span>' : '') + '</div>' +
        '<div class="tt-arrow">↓</div>' +
        '<div class="tt-r"><b>' + esc(nb) + '</b>' + (c.puertoHasta != null ? ' <span class="tt-p">· puerto ' + c.puertoHasta + '</span>' : '') + '</div>' +
        '<div class="tt-f">' + esc(c.tipo || '?') + ' · ' + esc(c.velocidad || '—') + ' · ' +
        (i.caido ? '<span class="tt-bad">INTERRUMPIDO</span>' : i.deg ? '<span style="color:#f39c12">degradado</span>' : '<span class="tt-ok">operativo</span>') + '</div>';
}

/* ---------- carga ---------- */
function splash(p, t) { $('#splashBar').style.width = p + '%'; if (t) $('#splashStatus').textContent = t; }
function api(u, o) { return fetch(u, Object.assign({ credentials: 'same-origin' }, o || {})).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }

function getQueryParams() {
    var params = {}, search = window.location.search;
    if (!search || search.length < 2) return params;
    var s = search.substring(1), pairs = s.split('&');
    for (var i = 0; i < pairs.length; i++) {
        var idx = pairs[i].indexOf('=');
        if (idx > 0) {
            params[decodeURIComponent(pairs[i].substring(0, idx))] = decodeURIComponent(pairs[i].substring(idx + 1).replace(/\+/g, ' '));
        }
    }
    return params;
}

// ?municipio= entra a ese municipio en el geomapa.
// ?enfocar= es de un equipo/contenedor interno: lo deriva al editor clásico.
function enfocarDesdeURL() {
    var q = getQueryParams();
    var munId = q.municipio || q.mun || '';
    var enfocarId = q.enfocar || q.focus || '';
    if (!munId && !enfocarId) return;
    try { history.replaceState({}, '', window.location.pathname); } catch (e) { }

    if (enfocarId) {
        var mid = munId;
        if (!mid) {
            for (var k in S.topos) {
                var found = null;
                var walk = function (o) { if (found) return; if (o.id === enfocarId) { found = o; return; } hijosDe(o).forEach(walk); };
                (S.topos[k].unidades || []).forEach(walk);
                if (found) { mid = k; break; }
            }
        }
        if (!mid) return;
        var m0 = geoDe(mid);
        var p0 = '?municipio=' + encodeURIComponent(mid);
        if (m0 && m0.nombre) p0 += '&nombre=' + encodeURIComponent(m0.nombre);
        p0 += '&enfocar=' + encodeURIComponent(enfocarId);
        window.location.href = '/private/topologia.html' + p0;
        return;
    }
    var m = geoDe(munId);
    if (m) entrarMun(m);
}

async function boot() {
    if (arrancado) return; arrancado = true;
    loadCapa();
    splash(8, 'Verificando sesión…');
    var ses; try { ses = await api('/api/sesion'); } catch (e) { location.href = '/'; return; }
    S.rol = ses.rol || 'operador'; S.usuario = ses.nombre || ses.usuario || '';
    var rb = $('#roleBadge'); rb.textContent = S.rol; if (S.rol === 'operador') rb.classList.add('op');

    splash(18, 'Cargando municipios…');
    try { S.munis = await api('/api/municipios'); } catch (e) { S.munis = []; }
    splash(28, 'Cargando cartografía…');
    var gj = null; try { gj = await api('/private/geo/municipios.geojson'); } catch (e) { }
    S.geo = matchGeo(gj);

    splash(40, 'Cargando topologías…');
    var tot = S.munis.length || 1, dn = 0;
    await Promise.all(S.munis.map(function (m) {
        return api('/api/topologia/db/' + encodeURIComponent(m.id)).catch(function () { return { nombre: m.nombre, unidades: [], conexiones: [] }; })
            .then(function (t) { t.unidades = t.unidades || []; t.conexiones = t.conexiones || []; S.topos[m.id] = t; dn++; splash(40 + Math.round(dn / tot * 36), 'Topologías ' + dn + '/' + tot); });
    }));
    splash(80, 'Estados…'); try { S.estados = await api('/api/estados'); } catch (e) { S.estados = {}; }
    splash(88, 'Enlaces inter-municipio…'); try { S.globales = await api('/api/topologia/conexiones-globales'); } catch (e) { S.globales = []; }
    splash(92, 'Sincronizando capa geográfica…');
    await syncCapa();
    splash(96, 'Proyectando…');
    construirGeo(); initMap(); initUI(); renderAll(); renderInspector(); updateChips();
    splash(100, 'Listo');
    setTimeout(function () {
        $('#splash').classList.add('out');
        setTimeout(function () { safe(enfocarDesdeURL, 'url-focus'); }, 450);
    }, 300);
    setInterval(function () { safe(refrescar, 'refresh'); }, 30000);
}

/* ---------- emparejamiento de nombres / recorte territorial ---------- */
function canon(s) {
    var n = norm(s), map = {
        pinar: 'pinardelrio', pinardelrio: 'pinardelrio',
        consolacion: 'consolaciondelsur', consolaciondelsur: 'consolaciondelsur',
        sanjuan: 'sanjuanymartinez', sanjuanymartinez: 'sanjuanymartinez',
        minas: 'minasdematahambre', minasdematahambre: 'minasdematahambre', minasmatahambre: 'minasdematahambre',
        palma: 'lapalma', lapalma: 'lapalma',
        palacios: 'lospalacios', lospalacios: 'lospalacios',
        sandino: 'sandino', mantua: 'mantua', guane: 'guane', vinales: 'vinales', sanluis: 'sanluis'
    };
    return map[n] || n;
}
function featName(p) {
    p = p || {};
    return p.name || p['name:es'] || p.NAME || p.nombre || p.NAME_2 || p.NL_NAME_2 || (p.tags && p.tags.name) || '';
}
function quitarRuido(s) {
    return canon(String(s || '').replace(/municipio|mun\.?|province|provincia/gi, ' ').trim());
}
window.RIMdiag = function () {
    console.table(S.geo.map(function (m) { return { id: m.id, nombre: m.nombre, poligono: m.real ? 'SÍ' : 'NO — aproximado' }; }));
    return 'Si alguno sale NO, su nombre no coincide con el GeoJSON.';
};
function contarVertices(g) {
    var n = 0;
    var walk = function (a) { if (typeof a[0] === 'number') { n++; return; } a.forEach(walk); };
    try { walk(g.coordinates); } catch (e) { }
    return n;
}
function limpiarFeatures(feats) {
    var porClave = {}, i, f, k, nv, dup = 0;
    for (i = 0; i < feats.length; i++) {
        f = feats[i];
        if (!f || !f.geometry || !f.geometry.coordinates) continue;
        if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
        k = quitarRuido(featName(f.properties));
        if (!k) continue;
        nv = contarVertices(f.geometry);
        if (porClave[k]) { dup++; if (nv <= porClave[k].nv) continue; }
        porClave[k] = { f: f, nv: nv };
    }
    var out = Object.keys(porClave).map(function (x) { return porClave[x].f; });
    if (dup) console.log('[GeoMapa] GeoJSON: ' + feats.length + ' features → ' + out.length + ' únicos (' + dup + ' duplicados)');
    return out;
}
function anillosExteriores(g) {
    if (!g) return [];
    if (g.type === 'Polygon') return [g.coordinates[0]];
    if (g.type === 'MultiPolygon') return g.coordinates.map(function (p) { return p[0]; });
    return [];
}
function boundsProvincia() {
    var b = null;
    S.geo.forEach(function (m) {
        if (!m.bounds) return;
        b = b ? b.extend(m.bounds) : L.latLngBounds(m.bounds.getSouthWest(), m.bounds.getNorthEast());
    });
    return b;
}
function construirMascara() {
    if (lMask) { map.removeLayer(lMask); lMask = null; }
    var prov = boundsProvincia(); if (!prov) return;
    var agujeros = [];
    S.geo.forEach(function (m) {
        if (m.feature) {
            anillosExteriores(m.feature.geometry).forEach(function (r) {
                if (!r || r.length < 4) return;
                agujeros.push(r.map(function (c) { return [c[1], c[0]]; }));
            });
        } else if (m.bounds) {
            var b = m.bounds;
            agujeros.push([[b.getSouth(), b.getWest()], [b.getSouth(), b.getEast()], [b.getNorth(), b.getEast()], [b.getNorth(), b.getWest()]]);
        }
    });
    if (!agujeros.length) return;
    var ext = prov.pad(1.2);
    var marco = [
        [ext.getSouth(), ext.getWest()], [ext.getSouth(), ext.getEast()],
        [ext.getNorth(), ext.getEast()], [ext.getNorth(), ext.getWest()]
    ];
    lMask = L.polygon([marco].concat(agujeros), {
        stroke: true, color: '#22d3ee', weight: 1.4, opacity: .45,
        fillColor: '#0a1120', fillOpacity: .96, fillRule: 'evenodd',
        interactive: false, smoothFactor: 1.2
    }).addTo(map);
}
function matchGeo(gj) {
    var feats = limpiarFeatures((gj && gj.features) || []), out = [], usados = {};
    var FB = {
        sandino: [2.5, 50, 32, 22], mantua: [17.1, 26.5, 17.6, 14], minasdematahambre: [28.5, 19.4, 13.8, 12],
        vinales: [38.4, 15.9, 15, 12], lapalma: [48.1, 9.8, 14.3, 12], guane: [25.2, 33.1, 14.1, 12],
        sanluis: [43.9, 38.6, 16.5, 13], sanjuanymartinez: [35, 33, 14.3, 12], pinardelrio: [44.7, 28.1, 17.9, 13],
        consolaciondelsur: [51.4, 21.6, 17.7, 14], lospalacios: [58, 17.4, 19.1, 14]
    };
    var PB = { s: 21.70, n: 23.10, w: -85.10, e: -82.90 }, slot = 0;
    S.munis.forEach(function (m) {
        var objetivo = quitarRuido(m.nombre), f = null, i, cand;
        for (i = 0; i < feats.length; i++) {
            if (usados[i]) continue;
            if (quitarRuido(featName(feats[i].properties)) === objetivo) { f = feats[i]; usados[i] = true; break; }
        }
        if (!f) {
            for (i = 0; i < feats.length; i++) {
                if (usados[i]) continue;
                cand = quitarRuido(featName(feats[i].properties));
                if (cand && objetivo && (cand.indexOf(objetivo) >= 0 || objetivo.indexOf(cand) >= 0)) { f = feats[i]; usados[i] = true; break; }
            }
        }
        if (f && (!f.geometry || !f.geometry.coordinates)) f = null;
        var b = null;
        if (f) {
            try {
                var tb = L.geoJSON(f).getBounds();
                if (tb && isFinite(tb.getSouth()) && isFinite(tb.getWest()) && isFinite(tb.getNorth()) && isFinite(tb.getEast())) b = tb;
            } catch (e) { b = null; }
        }
        if (!b) f = null;
        if (!b) {
            var q = FB[objetivo] || FB[canon(m.id)];
            if (!q) { var col = slot % 4, row = Math.floor(slot / 4); slot++; q = [3 + col * 24, 12 + row * 26, 21, 22]; }
            var wl = PB.w + q[0] / 100 * (PB.e - PB.w), wr = wl + q[2] / 100 * (PB.e - PB.w);
            var nt = PB.n - q[1] / 100 * (PB.n - PB.s), sb = nt - q[3] / 100 * (PB.n - PB.s);
            b = L.latLngBounds([sb, wl], [nt, wr]);
            console.warn('[GeoMapa] Sin polígono para "' + m.nombre + '" → aproximado.');
        }
        out.push({ id: m.id, nombre: m.nombre, feature: f, bounds: b, centro: b.getCenter(), real: !!f });
    });
    return out;
}
function geoDe(id) { for (var i = 0; i < S.geo.length; i++) if (S.geo[i].id === id) return S.geo[i]; return null; }

/* ---------- mapa ---------- */
function initMap() {
    var prov = boundsProvincia();
    var opts = { minZoom: 9, maxZoom: 18, zoomSnap: .5, zoomDelta: .5, doubleClickZoom: false, zoomControl: true };
    if (prov) { opts.maxBounds = prov.pad(.15); opts.maxBoundsViscosity = 1.0; }
    map = L.map('mapa', opts);
    if (prov) map.fitBounds(prov.pad(.03)); else map.setView([22.42, -83.95], 9);

    L.tileLayer('/private/tiles/{z}/{x}/{y}.png', {
        maxZoom: 18, maxNativeZoom: 14, minZoom: 9,
        errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        attribution: '© OpenStreetMap'
    }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    construirMascara();

    lMuni = L.layerGroup().addTo(map); lInter = L.layerGroup().addTo(map); lIntra = L.layerGroup().addTo(map);
    lCont = L.layerGroup().addTo(map); lEq = L.layerGroup().addTo(map); lPort = L.layerGroup().addTo(map); lHand = L.layerGroup().addTo(map);
    map.on('zoomend moveend', function () { safe(updateLOD, 'lod'); safe(renderCon, 'con'); safe(renderMuni, 'muni'); safe(hud, 'hud'); });
    map.on('click', cerrarCtx);
    map.on('contextmenu', function (e) { L.DomEvent.preventDefault(e.originalEvent); safe(function () { ctxVacio(e); }, 'ctx'); });
}
function hud() {
    var f = S.foco;
    $('#zoomHud').innerHTML = 'ZOOM <b>' + map.getZoom().toFixed(1) + '</b> · ' + (f.nivel === 'provincia' ? 'PROVINCIA' : 'MUNICIPIO: ' + esc((geoDe(f.mun) || {}).nombre || ''));
}
function updateLOD() {
    if (S.arrastrando) return;
    var z = map.getZoom();
    // Si estamos en vista municipal y el zoom baja mucho, volver a provincia
    if (S.foco.nivel === 'municipio' && z < Z_MUNI - 1) {
        provincia();
        return;
    }
    // Ya no entramos automáticamente al municipio al hacer zoom en provincia
    safe(hud, 'hud');
}
function pip(lat, lng, rings) {
    var ins = false;
    for (var a = 0; a < rings.length; a++) { var p = rings[a]; for (var i = 0, j = p.length - 1; i < p.length; j = i++) { var xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1]; if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) ins = !ins; } }
    return ins;
}
function munEn(ll) {
    var i, k, m, g;
    for (i = 0; i < S.geo.length; i++) {
        m = S.geo[i]; if (!m.real || !m.bounds.contains(ll)) continue;
        g = m.feature.geometry;
        if (g.type === 'Polygon' && pip(ll.lat, ll.lng, g.coordinates)) return m;
        if (g.type === 'MultiPolygon') for (k = 0; k < g.coordinates.length; k++) if (pip(ll.lat, ll.lng, g.coordinates[k])) return m;
    }
    var best = null, bd = 0.12;
    for (i = 0; i < S.geo.length; i++) {
        m = S.geo[i]; if (!m.real) continue;
        var d = Math.sqrt(Math.pow(m.centro.lat - ll.lat, 2) + Math.pow(m.centro.lng - ll.lng, 2));
        if (d < bd) { bd = d; best = m; }
    }
    if (best) return best;
    var ba = Infinity; best = null;
    for (i = 0; i < S.geo.length; i++) {
        m = S.geo[i]; if (m.real || !m.bounds.contains(ll)) continue;
        var r = m.bounds, a = (r.getNorth() - r.getSouth()) * (r.getEast() - r.getWest());
        if (a < ba) { ba = a; best = m; }
    }
    return best;
}

/* ---------- render ---------- */
function renderAll() { safe(renderMuni, 'muni'); safe(renderCont, 'cont'); safe(renderEq, 'eq'); safe(renderCon, 'con'); safe(hud, 'hud'); safe(crumbs, 'crumbs'); }

function renderMuni() {
    lMuni.clearLayers();
    var z = map.getZoom();
    S.geo.forEach(function (m) {
        var st = estadosMun(m.id), bad = st.offline, cnt = contar(S.topos[m.id]).total;
        var active = S.foco.mun === m.id;
        var opt = { color: bad ? C.bad : (active ? '#22d3ee' : '#12395e'), weight: active ? 3 : 2.2, fillColor: bad ? '#e74c3c' : '#3498db', fillOpacity: active ? .04 : FILL, opacity: 1 };
        var ly = m.feature ? L.geoJSON(m.feature, { style: opt }) : L.rectangle(m.bounds, opt);
        ly.on('click', function (e) {
            L.DomEvent.stopPropagation(e);
            if (S.modo) { pickMun(m); return; }
            if (S.foco.nivel === 'provincia') entrarMun(m);
        });
        ly.on('contextmenu', function (e) { L.DomEvent.stopPropagation(e.originalEvent); ctxMun(e, m); });
        ly.addTo(lMuni);
        var mostrar = S.foco.nivel === 'provincia' || (!active && z < Z_MUNI + 1.5);
        if (mostrar) {
            L.marker(m.centro, {
                interactive: false, zIndexOffset: 200,
                icon: L.divIcon({ className: 'muni-icon', iconSize: null, html: '<div class="muni-tag">' + esc(m.nombre) + '<span class="n">' + cnt + ' eq</span>' + (bad ? '<span class="bad">● ' + bad + '</span>' : '') + '</div>' })
            }).addTo(lMuni);
        }
    });
}

// Nivel municipio: las unidades viven sobre el mapa, arrastrables dentro del polígono
function renderCont() {
    lCont.clearLayers(); REF.cont = {};
    if (S.foco.nivel !== 'municipio') return;
    var mid = S.foco.mun;
    unidadesDe(mid).forEach(function (o) {
        var g = GEO[o.id]; if (!g || !g.rect) return;
        var lk = locked(o.id), n = collectEq(o).length, sel = S.sel === o.id, bad = unidadConCaidas(o);
        var rect = L.rectangle(g.rect, {
            color: lk ? '#e056a0' : (bad ? C.bad : '#22d3ee'),
            weight: sel ? 3 : 1.8,
            fillColor: lk ? '#e056a0' : (bad ? '#e74c3c' : '#0f3460'),
            fillOpacity: .16,
            dashArray: CAPA.pos[o.id] ? null : '6 4'
        }).addTo(lCont);
        if (rect._path) rect._path.setAttribute('rx', '7');
        rect.on('click', function (e) { L.DomEvent.stopPropagation(e); clickObj(o); });
        rect.on('dblclick', function (e) { L.DomEvent.stopPropagation(e); abrirEditorUnidad(o); });
        rect.on('contextmenu', function (e) { L.DomEvent.stopPropagation(e.originalEvent); ctxObj(e, o); });
        REF.cont[o.id] = rect;

        var drag = puedeTocar(o.id);
        var tag = L.marker(posLL(o.id), {
            draggable: drag, zIndexOffset: 650, autoPan: true,
            icon: L.divIcon({
                className: 'cont-icon', iconSize: null,
                html: '<div class="cont-tag' + (lk ? ' lk' : '') + (sel ? ' sel' : '') + '">' + (ICO[o.tipo] || '') + ' ' + esc(nombreDe(o)) + ' <b>' + n + '</b>' + (drag ? '<span class="grip">⠿</span>' : (lk ? ' 🔒' : '')) + '</div>'
            })
        }).addTo(lCont);
        tag.on('dragstart', function () { S.arrastrando = true; });
        tag.on('drag', function () {
            var p = clampCentro(g.rect, tag.getLatLng(), limiteDeMunicipio(mid));
            tag.setLatLng(p);
            var dla = p.lat - g.lat, dln = p.lng - g.lng;
            rect.setBounds(L.latLngBounds([g.rect.getSouth() + dla, g.rect.getWest() + dln], [g.rect.getNorth() + dla, g.rect.getEast() + dln]));
        });
        tag.on('dragend', function () {
            S.arrastrando = false;
            var p = clampCentro(g.rect, tag.getLatLng(), limiteDeMunicipio(mid));
            CAPA.pos[o.id] = [p.lat, p.lng]; saveCapa(); construirGeo(); renderAll();
            toast('ok', '📍', '"' + nombreDe(o) + '" reubicada dentro del municipio');
        });
        tag.on('click', function (e) { L.DomEvent.stopPropagation(e); clickObj(o); });
        tag.on('dblclick', function (e) { L.DomEvent.stopPropagation(e); abrirEditorUnidad(o); });
        tag.on('contextmenu', function (e) { L.DomEvent.stopPropagation(e.originalEvent); ctxObj(e, o); });
    });
}

// En el geomapa no se pintan equipos sueltos: el detalle vive en el editor clásico
function renderEq() { lEq.clearLayers(); REF.eq = {}; }

function renderCon() {
    lIntra.clearLayers(); lInter.clearLayers(); lPort.clearLayers(); lHand.clearLayers();
    REF.lines = {}; REF.con = {}; REF.hits = {};

    S.globales.forEach(function (g) {
        var a = posLL(g.desde_id) || (geoDe(g.desde_municipio_id) || {}).centro;
        var b = posLL(g.hasta_id) || (geoDe(g.hasta_municipio_id) || {}).centro;
        if (!a || !b) return;
        pintar({ id: g.id, desde: g.desde_id, hasta: g.hasta_id, tipo: g.tipo, velocidad: g.velocidad, puertoDesde: g.puerto_desde, puertoHasta: g.puerto_hasta, inter: true },
            a, b, 0, 1,
            nombreDe(OBJ[g.desde_id]) + ' (' + (g.desde_municipio_nombre || '') + ')',
            nombreDe(OBJ[g.hasta_id]) + ' (' + (g.hasta_municipio_nombre || '') + ')',
            lInter);
    });

    if (S.foco.nivel !== 'municipio') { if (S.connSel) handles(S.connSel); return; }
    var t = S.topos[S.foco.mun]; if (!t) return;
    var gr = {};
    (t.conexiones || []).forEach(function (c) {
        var ra = representante(c.desde), rb = representante(c.hasta);
        if (!ra || !rb || ra.id === rb.id) return;
        var k = ra.id < rb.id ? ra.id + '|' + rb.id : rb.id + '|' + ra.id;
        (gr[k] = gr[k] || []).push({ c: c, a: ra, b: rb });
    });
    Object.keys(gr).forEach(function (k) {
        gr[k].forEach(function (it, i) {
            var a = posLL(it.a.id), b = posLL(it.b.id);
            if (!a || !b) return;
            var na = nombreDe(OBJ[it.c.desde]), nb = nombreDe(OBJ[it.c.hasta]);
            if (it.a.id !== it.c.desde) na += ' › ' + nombreDe(it.a);
            if (it.b.id !== it.c.hasta) nb += ' › ' + nombreDe(it.b);
            pintar(it.c, a, b, i, gr[k].length, na, nb, lIntra);
        });
    });
    if (S.connSel) handles(S.connSel);
}

function pintar(c, a, b, idx, n, na, nb, layer) {
    var i = infoCon(c), pts = trazo(c, a, b, idx, n);
    var sel = S.connSel === c.id;
    REF.con[c.id] = { a: a, b: b, idx: idx, n: n, data: c, na: na, nb: nb };

    var ln = L.polyline(pts, {
        color: i.color, weight: WLINE * (sel ? 1.9 : 1), opacity: c.inter ? .9 : .95,
        dashArray: c.inter && !i.caido ? '12 7' : i.dash, lineCap: 'round',
        className: i.caido ? '' : 'flowing', interactive: false
    }).addTo(layer);
    REF.lines[c.id] = ln;

    var hit = L.polyline(pts, { color: 'transparent', weight: 16, opacity: 0, lineCap: 'round', className: 'con-hit', interactive: true }).addTo(layer);
    REF.hits[c.id] = hit;
    hit.bindTooltip(tipCon(c, na, nb), { sticky: true, className: 'geo-tip', opacity: 1 });
    hit.on('click', function (e) {
        L.DomEvent.stopPropagation(e); if (S.modo) return;
        if (sel && !c.inter && puedeTocar(c.id)) { addPunto(c.id, e.latlng); return; }
        S.connSel = c.id; S.sel = null; renderCon(); inspCon(c, na, nb);
        if (sel && c.inter) toast('info', 'ℹ️', 'Los enlaces inter-municipio no admiten curvas');
        else if (sel && locked(c.id)) toast('warn', '🔒', 'Enlace bloqueado: desbloquéalo para curvarlo');
    });
    hit.on('contextmenu', function (e) { L.DomEvent.stopPropagation(e.originalEvent); ctxCon(e, c); });

    if (i.caido) L.marker(pts[Math.floor(pts.length / 2)], { interactive: false, zIndexOffset: 600, icon: L.divIcon({ className: 'cut-icon', iconSize: [20, 20], iconAnchor: [10, 10], html: '<div class="cut-badge">✕</div>' }) }).addTo(layer);
    if (map.getZoom() >= Z_DETAIL && !c.inter) {
        if (c.puertoDesde != null) L.marker(a, { interactive: false, icon: L.divIcon({ className: 'port-label', iconSize: null, html: 'p' + c.puertoDesde }) }).addTo(lPort);
        if (c.puertoHasta != null) L.marker(b, { interactive: false, icon: L.divIcon({ className: 'port-label', iconSize: null, html: 'p' + c.puertoHasta }) }).addTo(lPort);
    }
}
function redibujarLinea(cid) {
    var r = REF.con[cid]; if (!r) return;
    var pts = trazo(r.data, r.a, r.b, r.idx, r.n);
    if (REF.lines[cid]) REF.lines[cid].setLatLngs(pts);
    if (REF.hits[cid]) REF.hits[cid].setLatLngs(pts);
}
function handles(cid) {
    var r = REF.con[cid]; if (!r) return;
    if (r.data.inter) return;
    var editable = puedeTocar(cid);
    var man = CAPA.curvas[cid] || [];
    man.forEach(function (p, i) {
        var h = L.marker(L.latLng(p[0], p[1]), {
            draggable: editable, zIndexOffset: 950,
            icon: L.divIcon({ className: 'handle-icon', iconSize: [15, 15], iconAnchor: [7.5, 7.5], html: '<div class="handle-dot"></div>' })
        }).addTo(lHand);
        h.on('dragstart', function () { S.arrastrando = true; });
        h.on('drag', function () { var ll = h.getLatLng(); man[i] = [ll.lat, ll.lng]; CAPA.curvas[cid] = man; redibujarLinea(cid); });
        h.on('dragend', function () { S.arrastrando = false; CAPA.curvas[cid] = man; saveCapa(); renderCon(); toast('info', '〰️', 'Curva actualizada'); });
        h.on('contextmenu', function (e) {
            L.DomEvent.stopPropagation(e.originalEvent);
            man.splice(i, 1);
            if (!man.length) delete CAPA.curvas[cid]; else CAPA.curvas[cid] = man;
            saveCapa(); renderCon(); toast('info', '✂️', 'Punto eliminado');
        });
    });
    if (!editable) return;
    var anclas = [r.a].concat(man.map(function (p) { return L.latLng(p[0], p[1]); }), [r.b]);
    for (var t = 0; t < anclas.length - 1; t++) {
        (function (tramo) {
            var A = anclas[tramo], B = anclas[tramo + 1];
            var mid = L.latLng((A.lat + B.lat) / 2, (A.lng + B.lng) / 2);
            var g = L.marker(mid, {
                draggable: true, zIndexOffset: 940,
                icon: L.divIcon({ className: 'handle-icon', iconSize: [11, 11], iconAnchor: [5.5, 5.5], html: '<div class="handle-ghost"></div>' })
            }).addTo(lHand);
            g.bindTooltip('Arrastra para curvar', { direction: 'top', className: 'geo-tip' });
            var insertado = false;
            g.on('dragstart', function () { S.arrastrando = true; man.splice(tramo, 0, [mid.lat, mid.lng]); CAPA.curvas[cid] = man; insertado = true; g.closeTooltip(); });
            g.on('drag', function () { if (!insertado) return; var ll = g.getLatLng(); man[tramo] = [ll.lat, ll.lng]; CAPA.curvas[cid] = man; redibujarLinea(cid); });
            g.on('dragend', function () { S.arrastrando = false; if (!insertado) return; CAPA.curvas[cid] = man; saveCapa(); renderCon(); toast('ok', '〰️', 'Punto de curva creado'); });
        })(t);
    }
}
function addPunto(cid, ll) { var m = (CAPA.curvas[cid] || []).slice(); m.push([ll.lat, ll.lng]); CAPA.curvas[cid] = m; saveCapa(); renderCon(); toast('info', '➕', 'Punto añadido · arrástralo para curvar'); }

/* ---------- navegación ---------- */
function entrarMun(m) {
    if (!m) return;
    var params = '?municipio=' + encodeURIComponent(m.id);
    if (m.nombre) params += '&nombre=' + encodeURIComponent(m.nombre);
    window.location.href = '/private/topologia.html' + params;
}
function abrirEditorUnidad(o) {
    var mid = MUN_DE[o.id] || S.foco.mun;
    var m = mid ? geoDe(mid) : null;
    var params = '?municipio=' + encodeURIComponent(mid || '');
    if (m && m.nombre) params += '&nombre=' + encodeURIComponent(m.nombre);
    params += '&enfocar=' + encodeURIComponent(o.id);
    window.location.href = '/private/topologia.html' + params;
}
function clickObj(o) { if (S.modo) { pickObj(o); return; } S.sel = o.id; S.connSel = null; renderCont(); renderCon(); renderInspector(); }
function crumbs() {
    var h = '<span class="crumb' + (S.foco.nivel === 'provincia' ? ' last' : '') + '" data-a="prov">🗺️ Pinar del Río</span>';
    if (S.foco.mun) {
        var m = geoDe(S.foco.mun);
        h += '<span class="crumb-sep">›</span><span class="crumb last" data-a="mun">' + esc(m ? m.nombre : '') + '</span>';
    }
    $('#crumbs').innerHTML = h;
    $$('#crumbs .crumb').forEach(function (el) {
        el.addEventListener('click', function () {
            if (this.getAttribute('data-a') === 'prov') provincia();
        });
    });
}
function provincia() {
    S.foco = { nivel: 'provincia', mun: null }; S.sel = null; S.connSel = null;
    var prov = boundsProvincia();
    if (prov) map.fitBounds(prov.pad(.03));
    renderAll(); renderInspector();
}

/* ---------- chips / refresh ---------- */
function updateChips() {
    var tot = 0, on = 0, off = 0, deg = 0;
    S.geo.forEach(function (m) { tot += contar(S.topos[m.id]).total; var s = estadosMun(m.id); on += s.online; off += s.offline; deg += s.degradado; });
    $('#statChips').innerHTML = '<span class="chip"><b>' + tot + '</b> equipos</span><span class="chip ok"><b>' + on + '</b> en línea</span><span class="chip bad"><b>' + off + '</b> caídos</span><span class="chip warn"><b>' + deg + '</b> degradados</span><span class="chip"><b>' + S.globales.length + '</b> inter-mun.</span>';
    var p = $('#livePill'); p.className = 'live-pill' + (off ? ' warn' : '');
    p.innerHTML = '<i class="dot"></i><span>' + (off ? off + ' incidencias' : 'Red estable') + ' · ' + new Date().toLocaleTimeString() + '</span>';
}
async function refrescar() {
    try { S.estados = await api('/api/estados'); } catch (e) { return; }
    renderCon(); renderMuni(); renderCont(); updateChips();
    if (S.sel || S.connSel) renderInspector();
}

/* ---------- inspector ---------- */
function kv(k, v) { return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>'; }
function renderInspector() {
    if (S.connSel) return;
    $('#inspector').hidden = false;
    if (S.sel && OBJ[S.sel]) return inspObj(OBJ[S.sel]);
    var b = $('#inspBody'), t = $('#inspTitle');

    if (S.foco.nivel === 'provincia') {
        t.textContent = 'Resumen provincial';
        var tot = 0, sw = 0, on = 0, off = 0, deg = 0, unk = 0;
        S.geo.forEach(function (m) { var c = contar(S.topos[m.id]); tot += c.total; sw += c.switch; var s = estadosMun(m.id); on += s.online; off += s.offline; deg += s.degradado; unk += s.desconocido; });
        var tt = on + off + deg + unk || 1;
        b.innerHTML = '<div class="insp-hero"><div class="insp-ico">🗺️</div><div class="insp-hero-t"><b>Pinar del Río</b><span>' + S.geo.length + ' municipios</span></div></div>' +
            '<div class="bar-state"><i style="width:' + on / tt * 100 + '%;background:#21c063"></i><i style="width:' + deg / tt * 100 + '%;background:#f39c12"></i><i style="width:' + off / tt * 100 + '%;background:#e74c3c"></i><i style="width:' + unk / tt * 100 + '%;background:#95a5a6"></i></div>' +
            '<div class="state-legend"><span><i style="background:#21c063"></i>' + on + '</span><span><i style="background:#f39c12"></i>' + deg + '</span><span><i style="background:#e74c3c"></i>' + off + '</span><span><i style="background:#95a5a6"></i>' + unk + '</span></div>' +
            '<div class="insp-sec"><h4>Inventario</h4>' + kv('Equipos', tot) + kv('Switches', sw) + kv('Enlaces inter-municipio', S.globales.length) + '</div>' +
            '<div class="insp-sec"><h4>Cómo navegar</h4><div class="ro-note"><b>Clic</b> en un municipio para editarlo sobre el mapa. <b>Doble clic</b> en una unidad abre su interior en el editor clásico. <b>Clic derecho</b> crea unidades y enlaces.</div></div>';
        return;
    }

    var m = geoDe(S.foco.mun), topo = S.topos[S.foco.mun] || {}, c = contar(topo), s = estadosMun(S.foco.mun);
    var us = unidadesDe(S.foco.mun);
    t.textContent = m ? m.nombre : 'Municipio';
    var h = '<div class="insp-hero"><div class="insp-ico">🏛️</div><div class="insp-hero-t"><b>' + esc(m ? m.nombre : '') + '</b><span>Municipio</span></div></div>' +
        kv('Unidades', us.length) + kv('Equipos', c.total) + kv('Switches', c.switch) +
        kv('Enlaces internos', (topo.conexiones || []).length) + kv('En línea / caídos', s.online + ' / ' + s.offline) +
        '<div class="insp-sec"><h4>Unidades (' + us.length + ')</h4><div class="mini-list scroll">';
    if (!us.length) h += '<div class="empty">Sin unidades. Clic derecho en el mapa para crear la primera.</div>';
    us.forEach(function (o) {
        h += '<div class="ml-item" data-id="' + esc(o.id) + '"><i class="d" style="background:' + (unidadConCaidas(o) ? C.bad : '#22d3ee') + '"></i><span class="t">' + (ICO[o.tipo] || '') + ' ' + esc(nombreDe(o)) + '</span><span class="m">' + collectEq(o).length + '</span></div>';
    });
    h += '</div></div>';
    if (puedeEditar()) {
        h += '<div class="insp-actions">' +
            '<button type="button" class="ia wide" data-a="nueva">🔌 Nueva conexión</button>' +
            '<button type="button" class="ia wide" data-a="unidad">🏢 Nueva unidad</button>' +
            '<button type="button" class="ia wide" data-a="export">📥 Exportar inventario</button>' +
            '</div>';
    } else h += '<div class="ro-note">👁️ Modo lectura.</div>';
    b.innerHTML = h;

    $$('#inspBody .ml-item').forEach(function (el) {
        el.addEventListener('click', function () {
            var o = OBJ[this.getAttribute('data-id')]; if (!o) return;
            clickObj(o);
            var g = GEO[o.id]; if (g && g.rect) map.fitBounds(g.rect.pad(.6), { maxZoom: 16 });
        });
    });
    var A = function (a) { return $('#inspBody [data-a="' + a + '"]'); };
    if (A('nueva')) A('nueva').addEventListener('click', function () { modo('FO'); });
    if (A('unidad')) A('unidad').addEventListener('click', function () { modalCrear('unidad', (geoDe(S.foco.mun) || {}).centro, S.foco.mun); });
    if (A('export')) A('export').addEventListener('click', function () { abrirModalExportar(); });
}
function inspObj(o) {
    $('#inspector').hidden = false; $('#inspTitle').textContent = nombreDe(o);
    var lk = locked(o.id);
    var eqs = collectEq(o);
    var h = '<div class="insp-hero"><div class="insp-ico">' + (ICO[o.tipo] || '•') + '</div><div class="insp-hero-t"><b>' + esc(nombreDe(o)) + '</b><span>' + esc(o.tipo) + '</span></div></div>' +
        kv('Equipos dentro', eqs.length) + kv('Con caídas', unidadConCaidas(o) ? 'SÍ' : 'no') +
        kv('Posición', CAPA.pos[o.id] ? 'Manual (servidor)' : 'Automática');
    if (lk) h += '<div class="lock-note">🔒 Bloqueada: no puede moverse ni eliminarse hasta desbloquearla.</div>';
    if (puedeEditar()) {
        h += '<div class="insp-actions">' +
            '<button type="button" class="ia wide" data-a="entrar">↘ Gestionar interior (editor clásico)</button>' +
            '<button type="button" class="ia" data-a="centrar">🎯 Centrar</button>' +
            '<button type="button" class="ia lock" data-a="lock">' + (lk ? '🔓 Unlock' : '🔒 Lock') + '</button>' +
            '<button type="button" class="ia" data-a="editar"' + (lk ? ' disabled' : '') + '>✏️ Renombrar</button>' +
            '<button type="button" class="ia del" data-a="borrar"' + (lk ? ' disabled' : '') + '>🗑 Eliminar</button></div>' +
            '<div class="ro-note">Arrastra la <b>etiqueta ⠿</b> para reubicarla dentro del municipio. Doble clic abre su interior.</div>';
    } else h += '<div class="ro-note">👁️ Modo lectura.</div>';
    $('#inspBody').innerHTML = h;
    var A = function (a) { return $('#inspBody [data-a="' + a + '"]'); };
    if (A('entrar')) A('entrar').addEventListener('click', function () { abrirEditorUnidad(o); });
    if (A('centrar')) A('centrar').addEventListener('click', function () { var g = GEO[o.id]; if (g && g.rect) map.fitBounds(g.rect.pad(.6), { maxZoom: 16 }); });
    if (A('lock')) A('lock').addEventListener('click', function () { toggleLock(o.id); });
    if (A('editar')) A('editar').addEventListener('click', function () { modalEditar(o); });
    if (A('borrar')) A('borrar').addEventListener('click', function () { borrarObj(o); });
}
function inspCon(c, na, nb) {
    $('#inspector').hidden = false; $('#inspTitle').textContent = 'Enlace';
    var i = infoCon(c), lk = locked(c.id), man = CAPA.curvas[c.id] || [];
    var h = '<div class="insp-hero"><div class="insp-ico" style="background:linear-gradient(140deg,#8e5a10,' + i.color + ')">🔗</div><div class="insp-hero-t"><b>' + esc(c.tipo) + ' · ' + esc(c.velocidad || '—') + '</b><span>' + (c.inter ? 'inter-municipio' : 'interno') + '</span></div></div>' +
        kv('Origen', na) + kv('Puerto origen', c.puertoDesde != null ? c.puertoDesde : '—') +
        kv('Destino', nb) + kv('Puerto destino', c.puertoHasta != null ? c.puertoHasta : '—') +
        kv('Estado', i.caido ? 'INTERRUMPIDO' : i.deg ? 'Degradado' : 'Operativo') + kv('Puntos de curva', man.length);
    if (lk) h += '<div class="lock-note">🔒 Enlace bloqueado.</div>';
    if (puedeEditar()) {
        h += '<div class="insp-actions">' + (!c.inter ? '<button type="button" class="ia" data-a="punto"' + (lk ? ' disabled' : '') + '>➕ Punto</button><button type="button" class="ia" data-a="fin"' + (lk || !man.length ? ' disabled' : '') + '>〰️ Enderezar</button>' : '') +
            '<button type="button" class="ia lock" data-a="lock">' + (lk ? '🔓 Unlock' : '🔒 Lock') + '</button>' +
            '<button type="button" class="ia del" data-a="borrar"' + (lk ? ' disabled' : '') + '>🗑 Eliminar</button></div>';
        if (!c.inter && !lk) h += '<div class="ro-note">Arrastra los <b>puntos tenues</b> del medio de cada tramo para curvar. Clic derecho sobre un punto sólido lo elimina.</div>';
    } else h += '<div class="ro-note">👁️ Modo lectura.</div>';
    $('#inspBody').innerHTML = h;
    var A = function (a) { return $('#inspBody [data-a="' + a + '"]'); };
    if (A('punto')) A('punto').addEventListener('click', function () { var a = posLL(c.desde), b = posLL(c.hasta); if (a && b) addPunto(c.id, L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2)); });
    if (A('fin')) A('fin').addEventListener('click', function () { delete CAPA.curvas[c.id]; saveCapa(); renderCon(); inspCon(c, na, nb); });
    if (A('lock')) A('lock').addEventListener('click', function () { toggleLock(c.id); inspCon(c, na, nb); });
    if (A('borrar')) A('borrar').addEventListener('click', function () { borrarCon(c); });
}

/* ---------- contextuales ---------- */
function cerrarCtx() { $('#ctxMenu').hidden = true; }
function abrirCtx(e, items, tit) {
    var el = $('#ctxMenu'), h = tit ? '<div class="ctx-title">' + esc(tit) + '</div>' : '';
    items.forEach(function (it) {
        if (it === '-') { h += '<div class="ctx-sep"></div>'; return; }
        h += '<button type="button" class="ctx-item ' + (it.cls || '') + '"' + (it.dis ? ' disabled' : '') + ' data-k="' + esc(it.k) + '"><span class="ci">' + it.i + '</span><span>' + esc(it.t) + '</span></button>';
    });
    el.innerHTML = h; el.hidden = false;
    var ev = e.originalEvent || e, r = el.getBoundingClientRect();
    el.style.left = Math.min(ev.clientX, window.innerWidth - r.width - 10) + 'px';
    el.style.top = Math.min(ev.clientY, window.innerHeight - r.height - 10) + 'px';
    $$('.ctx-item', el).forEach(function (b) {
        b.addEventListener('click', function () { var k = this.getAttribute('data-k'); cerrarCtx(); var it = items.filter(function (z) { return z !== '-' && z.k === k; })[0]; if (it && it.fn) safe(it.fn, 'ctx:' + k); });
    });
}
function ctxVacio(e) {
    var m = (S.foco.nivel === 'municipio') ? geoDe(S.foco.mun) : munEn(e.latlng);
    var it = [];
    if (puedeEditar()) {
        it.push({ k: 'f', i: '🔌', t: 'Nueva conexión · Fibra óptica', fn: function () { modo('FO'); if (m && S.foco.nivel === 'provincia') pickMun(m); } });
        it.push({ k: 'e', i: '🔌', t: 'Nueva conexión · Ethernet', fn: function () { modo('Ethernet'); if (m && S.foco.nivel === 'provincia') pickMun(m); } });
        if (m) {
            it.push('-');
            it.push({ k: 'nu', i: '🏢', t: 'Crear unidad en ' + m.nombre, fn: function () { modalCrear('unidad', e.latlng, m.id); } });
        }
    }
    if (m) {
        it.push('-');
        if (S.foco.nivel === 'provincia') it.push({ k: 'go', i: '↘', t: 'Entrar en ' + m.nombre, fn: function () { entrarMun(m); } });
        else it.push({ k: 'back', i: '🗺️', t: 'Volver a provincia', fn: provincia });
    } else {
        it.push('-');
        it.push({ k: 'nr', i: '⚠️', t: 'Fuera de Pinar del Río o sin municipio', dis: true, fn: null });
    }
    it.push('-');
    it.push({ k: 'z', i: '🔍', t: 'Zoom aquí', fn: function () { map.setView(e.latlng, Math.min(17, map.getZoom() + 2)); } });
    abrirCtx(e, it, m ? m.nombre : 'Vista provincial');
}
function ctxMun(e, m) {
    var it = [{ k: 'go', i: '↘', t: 'Editar ' + m.nombre, fn: function () { entrarMun(m); } }];
    if (puedeEditar()) {
        it.push('-');
        it.push({ k: 'u', i: '🏢', t: 'Crear unidad aquí', fn: function () { modalCrear('unidad', e.latlng, m.id); } });
        it.push({ k: 'f', i: '🔌', t: 'Enlace FO desde ' + m.nombre, fn: function () { modo('FO'); pickMun(m); } });
        it.push({ k: 'e', i: '🔌', t: 'Enlace ETH desde ' + m.nombre, fn: function () { modo('Ethernet'); pickMun(m); } });
    }
    abrirCtx(e, it, m.nombre);
}
function ctxObj(e, o) {
    var lk = locked(o.id);
    var it = [{ k: 'c', i: '🎯', t: 'Centrar', fn: function () { var g = GEO[o.id]; if (g && g.rect) map.fitBounds(g.rect.pad(.6), { maxZoom: 16 }); } }];
    it.push({ k: 'e', i: '↘', t: 'Gestionar interior (editor clásico)', fn: function () { abrirEditorUnidad(o); } });
    if (puedeEditar()) {
        it.push('-');
        it.push({ k: 'f', i: '🔌', t: 'Conexión FO desde ' + nombreDe(o), fn: function () { modo('FO'); pickObj(o); } });
        it.push({ k: 'e2', i: '🔌', t: 'Conexión ETH desde ' + nombreDe(o), fn: function () { modo('Ethernet'); pickObj(o); } });
        it.push('-');
        it.push({ k: 'l', i: lk ? '🔓' : '🔒', t: lk ? 'Unlock (desbloquear)' : 'Lock (bloquear)', cls: 'lock', fn: function () { toggleLock(o.id); } });
        it.push({ k: 'ed', i: '✏️', t: 'Renombrar', dis: lk, fn: function () { modalEditar(o); } });
        it.push({ k: 'rs', i: '📍', t: 'Posición automática', dis: lk || !CAPA.pos[o.id], fn: function () { delete CAPA.pos[o.id]; saveCapa(); construirGeo(); renderAll(); toast('info', '📍', 'Posición restaurada'); } });
        it.push('-');
        it.push({ k: 'dl', i: '🗑', t: 'Eliminar', cls: 'del', dis: lk, fn: function () { borrarObj(o); } });
    }
    abrirCtx(e, it, nombreDe(o));
}
function ctxCon(e, c) {
    var lk = locked(c.id);
    var it = [{ k: 'i', i: 'ℹ️', t: 'Ver detalles', fn: function () { S.connSel = c.id; renderCon(); inspCon(c, nombreDe(OBJ[c.desde]), nombreDe(OBJ[c.hasta])); } }];
    if (puedeEditar()) {
        if (!c.inter) it.push({ k: 'p', i: '➕', t: 'Añadir punto de curva', dis: lk, fn: function () { addPunto(c.id, e.latlng); } });
        it.push({ k: 'l', i: lk ? '🔓' : '🔒', t: lk ? 'Unlock' : 'Lock', cls: 'lock', fn: function () { toggleLock(c.id); } });
        it.push('-');
        it.push({ k: 'd', i: '🗑', t: 'Eliminar enlace', cls: 'del', dis: lk, fn: function () { borrarCon(c); } });
    }
    abrirCtx(e, it, 'Enlace ' + c.tipo);
}
function toggleLock(id) {
    if (!puedeEditar()) return;
    if (CAPA.locks[id]) delete CAPA.locks[id]; else CAPA.locks[id] = true;
    saveCapa(); renderAll();
    if (S.sel) renderInspector();
    toast(CAPA.locks[id] ? 'warn' : 'ok', CAPA.locks[id] ? '🔒' : '🔓', CAPA.locks[id] ? 'Bloqueado: nadie podrá moverlo ni eliminarlo' : 'Desbloqueado');
}

/* ---------- modo conexión ---------- */
function modo(tipo) {
    if (!puedeEditar()) { toast('bad', '⛔', 'Tu rol no permite crear conexiones'); return; }
    S.modo = { tipo: tipo, a: null }; $('#modeBanner').hidden = false;
    $('#modeText').textContent = tipo + ' · selecciona el ORIGEN (municipio o unidad)';
    toast('info', '🔌', 'Modo conexión · Esc para cancelar');
}
function salirModo() { S.modo = null; $('#modeBanner').hidden = true; renderMuni(); renderCont(); }
function pickMun(m) { pick({ mun: m.id, obj: null, label: m.nombre }); }
function pickObj(o) { pick({ mun: MUN_DE[o.id] || S.foco.mun, obj: o, label: nombreDe(o) }); }
function pick(t) {
    if (!S.modo) return;
    if (!S.modo.a) {
        S.modo.a = t;
        $('#modeText').textContent = S.modo.tipo + ' · origen: ' + t.label + ' → selecciona el DESTINO';
        if (t.obj && REF.cont[t.obj.id]) REF.cont[t.obj.id].setStyle({ color: '#ff9f1c', weight: 3 });
    } else {
        var a = S.modo.a, tipo = S.modo.tipo;
        salirModo();
        if (a.mun === t.mun && a.obj && t.obj && a.obj.id === t.obj.id) { toast('warn', '⚠️', 'Origen y destino iguales'); return; }
        modalCon(a, t, tipo);
    }
}

/* ---------- modales ---------- */
function abrirModal(t, h) { $('#modalTitle').textContent = t; $('#modalBody').innerHTML = h; $('#scrim').hidden = false; }
function cerrarModal() { $('#scrim').hidden = true; }
function opts(a, s) { return a.map(function (v) { return '<option' + (v === s ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join(''); }
function eqOpts(list) { return list.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(nombreDe(x)) + (x.ip ? ' · ' + esc(x.ip) : '') + '</option>'; }).join(''); }
function listaEq(t) {
    if (!t) return [];
    if (t.obj) return esHoja(t.obj.tipo) ? [t.obj] : collectEq(t.obj).filter(function (x) { return esEq(x.tipo); });
    return redDeMun(t.mun);
}
function modalCon(a, b, tipo) {
    var la = listaEq(a), lb = listaEq(b);
    if (!la.length || !lb.length) { toast('bad', '⛔', 'Ambos extremos necesitan equipos de red. Créalos primero en el editor clásico.'); return; }
    var inter = a.mun !== b.mun;
    var ma = geoDe(a.mun), mb = geoDe(b.mun);
    var h = '<div class="f-err" id="cErr" hidden></div>' +
        '<div class="f-grid"><div class="f-row"><label>Medio</label><select id="cTipo">' + opts(['FO', 'Ethernet'], tipo) + '</select></div>' +
        '<div class="f-row"><label>Velocidad</label><select id="cVel">' + opts(VEL, '1 Gbps') + '</select></div></div>' +
        '<div class="f-box"><h5>Origen · ' + esc(ma ? ma.nombre : '') + ' › ' + esc(a.label) + '</h5>' +
        '<div class="f-row"><label>Equipo</label><select id="cA">' + eqOpts(la) + '</select></div>' +
        '<div class="f-row"><label>Puerto</label><input type="number" id="cPA" min="1" placeholder="24"></div></div>' +
        '<div class="f-box"><h5>Destino · ' + esc(mb ? mb.nombre : '') + ' › ' + esc(b.label) + '</h5>' +
        '<div class="f-row"><label>Equipo</label><select id="cB">' + eqOpts(lb) + '</select></div>' +
        '<div class="f-row"><label>Puerto</label><input type="number" id="cPB" min="1" placeholder="1"></div></div>' +
        (inter ? '<div class="ro-note">Se creará como <b>enlace inter-municipio</b>.</div>' : '<div class="ro-note">Enlace interno del municipio. Para el detalle fino (puertos por edificio) usa el editor clásico.</div>') +
        '<div class="f-actions"><button type="button" class="mbtn" id="cCan">Cancelar</button><button type="button" class="mbtn pri" id="cOk">Crear enlace</button></div>';
    abrirModal('🔌 Nueva conexión', h);
    $('#cCan').addEventListener('click', cerrarModal);
    $('#cOk').addEventListener('click', async function () {
        var err = $('#cErr'), A = $('#cA').value, B = $('#cB').value;
        var PA = $('#cPA').value ? +$('#cPA').value : null, PB = $('#cPB').value ? +$('#cPB').value : null;
        var tp = $('#cTipo').value, vl = $('#cVel').value;
        err.hidden = true;
        if (!A || !B || A === B) { err.textContent = 'Selecciona dos equipos distintos.'; err.hidden = false; return; }
        if (!inter) {
            var t = S.topos[a.mun];
            var usado = function (eq, p) { return p != null && (t.conexiones || []).some(function (c) { return (c.desde === eq && c.puertoDesde === p) || (c.hasta === eq && c.puertoHasta === p); }); };
            if (usado(A, PA) || usado(B, PB)) { err.textContent = 'Uno de los puertos ya está ocupado.'; err.hidden = false; return; }
        }
        this.disabled = true; this.textContent = 'Creando…';
        try {
            if (inter) {
                await api('/api/topologia/conexion-global', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'cg-' + Date.now(), desde_id: A, hasta_id: B, desde_municipio_id: a.mun, hasta_municipio_id: b.mun, tipo: tp, velocidad: vl, puerto_desde: PA, puerto_hasta: PB }) });
                S.globales = await api('/api/topologia/conexiones-globales');
            } else {
                snapshot(a.mun);
                S.topos[a.mun].conexiones.push({ id: 'con-' + Date.now(), desde: A, hasta: B, tipo: tp, velocidad: vl, puertoDesde: PA, puertoHasta: PB });
                await guardar(a.mun);
            }
            cerrarModal(); construirGeo(); renderAll(); updateChips();
            toast('ok', '✅', 'Enlace ' + tp + ' creado', S.undo && !inter ? { txt: 'Deshacer', fn: undo } : null);
        } catch (e) { err.textContent = 'Error: ' + e.message; err.hidden = false; this.disabled = false; this.textContent = 'Crear enlace'; }
    });
}

function modalCrear(tipo, ll, mid) {
    if (!puedeEditar()) return;
    if (!S.geo.length) { toast('warn', '⚠️', 'No hay municipios registrados'); return; }
    var detId = mid || (munEn(ll || map.getCenter()) || {}).id || S.geo[0].id;
    var munOpts = S.geo.map(function (m) {
        return '<option value="' + esc(m.id) + '"' + (m.id === detId ? ' selected' : '') + '>' + esc(m.nombre) + (m.real ? '' : ' (aprox.)') + '</option>';
    }).join('');
    var h = '<div class="f-err" id="nErr" hidden></div>' +
        '<div class="f-box"><h5>Ubicación</h5>' +
        '<div class="f-row"><label>Municipio</label><select id="nMun">' + munOpts + '</select></div>' +
        '<div class="ro-note" id="nNota"></div></div>' +
        '<div class="f-box"><h5>Datos de la unidad</h5>' +
        '<div class="f-row"><label>Nombre *</label><input type="text" id="nD" placeholder="Ej: Unidad Empresarial Pinar"></div>' +
        '</div>' +
        '<div class="f-actions"><button type="button" class="mbtn" id="nCan">Cancelar</button><button type="button" class="mbtn pri" id="nOk">Crear</button></div>';
    abrirModal('➕ Nueva unidad', h);

    function nota() {
        var mg = geoDe($('#nMun').value);
        $('#nNota').innerHTML = mg && mg.real ? 'Se colocará donde hiciste clic, dentro del contorno del municipio.' : '⚠️ Este municipio no tiene polígono real: se colocará en su centro aproximado.';
    }
    $('#nMun').addEventListener('change', nota); nota();
    $('#nCan').addEventListener('click', cerrarModal);
    $('#nOk').addEventListener('click', async function () {
        var err = $('#nErr'), d = $('#nD').value.trim();
        if (!d) { err.textContent = 'El nombre es obligatorio.'; err.hidden = false; return; }
        var mSel = $('#nMun').value;
        snapshot(mSel);
        var o = { id: 'unidad-' + Date.now(), tipo: 'unidad', descripcion: d, nombre: d, x: 60, y: 60, width: 320, height: 240, edificios: [] };
        S.topos[mSel].unidades.push(o);
        this.disabled = true;
        try {
            await guardar(mSel); construirGeo();
            var g = GEO[o.id], destino = null;
            var lim = limiteDeMunicipio(mSel);
            if (ll && mSel === detId && lim && lim.contains(ll)) destino = ll;
            else if (g) destino = L.latLng(g.lat, g.lng);
            if (destino) { CAPA.pos[o.id] = [destino.lat, destino.lng]; saveCapa(); construirGeo(); }
            cerrarModal();
            if (S.foco.mun !== mSel) entrarMun(geoDe(mSel));
            S.sel = o.id;
            renderAll(); renderInspector(); updateChips();
            var pll = posLL(o.id);
            if (pll) map.setView(pll, Math.max(map.getZoom(), 14));
            renderAll();
            toast('ok', '✅', 'Unidad "' + d + '" creada en ' + (geoDe(mSel) || {}).nombre, { txt: 'Deshacer', fn: undo });
        } catch (e) { toast('bad', '⛔', e.message); this.disabled = false; }
    });
}

function modalEditar(o) {
    if (!puedeTocar(o.id)) { toast('bad', '🔒', 'Elemento bloqueado'); return; }
    var mid = MUN_DE[o.id];
    var h = '<div class="f-err" id="eErr" hidden></div>' +
        '<div class="f-box"><h5>Datos de la unidad</h5>' +
        '<div class="f-row"><label>Nombre *</label><input type="text" id="eD" value="' + esc(nombreDe(o)) + '"></div>' +
        '</div>' +
        '<div class="ro-note">El acomodo interno (edificios, locales, equipos) se edita en el editor clásico, no aquí.</div>' +
        '<div class="f-actions"><button type="button" class="mbtn" id="eCan">Cancelar</button><button type="button" class="mbtn pri" id="eOk">Guardar</button></div>';
    abrirModal('✏️ Renombrar · ' + nombreDe(o), h);
    $('#eCan').addEventListener('click', cerrarModal);
    $('#eOk').addEventListener('click', async function () {
        var d = $('#eD').value.trim();
        if (!d) { $('#eErr').textContent = 'El nombre es obligatorio.'; $('#eErr').hidden = false; return; }
        snapshot(mid); o.descripcion = d; o.nombre = d;
        this.disabled = true;
        try { await guardar(mid); cerrarModal(); renderAll(); renderInspector(); toast('ok', '💾', 'Guardado', { txt: 'Deshacer', fn: undo }); }
        catch (e) { toast('bad', '⛔', e.message); this.disabled = false; }
    });
}

function snapshot(mid) { if (mid && S.topos[mid]) S.undo = { mun: mid, data: JSON.stringify(S.topos[mid]) }; }
async function undo() {
    if (!S.undo) return; var u = S.undo; S.undo = null;
    S.topos[u.mun] = JSON.parse(u.data);
    try { await guardar(u.mun); construirGeo(); renderAll(); updateChips(); toast('ok', '↩️', 'Deshecho'); } catch (e) { toast('bad', '⛔', 'No se pudo deshacer'); }
}
function borrarObj(o) {
    if (!puedeTocar(o.id)) { toast('bad', '🔒', 'Bloqueado: desbloquéalo primero'); return; }
    var n = collectEq(o).length;
    abrirModal('🗑 Eliminar', '<p style="font-size:13px;line-height:1.6">¿Eliminar <b>' + esc(nombreDe(o)) + '</b>?' + (n ? '<br><span style="color:#ffb0a6">Contiene ' + n + ' equipos que también se eliminarán.</span>' : '') + '<br><span style="color:#9fb3c8;font-size:12px">Sus enlaces se retirarán. Podrás deshacer.</span></p><div class="f-actions"><button type="button" class="mbtn" id="dCan">Cancelar</button><button type="button" class="mbtn dgr" id="dOk">Eliminar</button></div>');
    $('#dCan').addEventListener('click', cerrarModal);
    $('#dOk').addEventListener('click', async function () {
        var mid = MUN_DE[o.id]; snapshot(mid);
        var t = S.topos[mid], ids = {}, mark = function (x) { ids[x.id] = 1; hijosDe(x).forEach(mark); }; mark(o);
        var consQuitadas = (t.conexiones || []).filter(function (c) { return ids[c.desde] || ids[c.hasta]; }).map(function (c) { return c.id; });
        t.unidades = (t.unidades || []).filter(function (u) { return !ids[u.id]; });
        t.conexiones = (t.conexiones || []).filter(function (c) { return !ids[c.desde] && !ids[c.hasta]; });
        this.disabled = true;
        try {
            await guardar(mid); cerrarModal(); S.sel = null;
            Object.keys(ids).forEach(function (id) { delete CAPA.locks[id]; delete CAPA.pos[id]; });
            consQuitadas.forEach(function (id) { delete CAPA.locks[id]; delete CAPA.curvas[id]; });
            saveCapa();
            construirGeo(); renderAll(); renderInspector(); updateChips();
            toast('ok', '🗑', 'Eliminado', { txt: 'Deshacer', fn: undo });
        } catch (e) { toast('bad', '⛔', e.message); this.disabled = false; }
    });
}
function borrarCon(c) {
    if (!puedeTocar(c.id)) { toast('bad', '🔒', 'Enlace bloqueado'); return; }
    abrirModal('🗑 Eliminar enlace', '<p style="font-size:13px;line-height:1.6">¿Eliminar el enlace <b>' + esc(c.tipo) + '</b> entre <b>' + esc(nombreDe(OBJ[c.desde])) + '</b> y <b>' + esc(nombreDe(OBJ[c.hasta])) + '</b>?</p><div class="f-actions"><button type="button" class="mbtn" id="dCan">Cancelar</button><button type="button" class="mbtn dgr" id="dOk">Eliminar</button></div>');
    $('#dCan').addEventListener('click', cerrarModal);
    $('#dOk').addEventListener('click', async function () {
        this.disabled = true;
        try {
            if (c.inter) { await api('/api/topologia/conexiones-globales/' + encodeURIComponent(c.id), { method: 'DELETE' }); S.globales = await api('/api/topologia/conexiones-globales'); }
            else { var mid = MUN_DE[c.desde] || S.foco.mun; snapshot(mid); S.topos[mid].conexiones = S.topos[mid].conexiones.filter(function (x) { return x.id !== c.id; }); await guardar(mid); }
            delete CAPA.curvas[c.id]; delete CAPA.locks[c.id]; saveCapa();
            S.connSel = null; cerrarModal(); renderCon(); renderInspector(); updateChips();
            toast('ok', '🗑', 'Enlace eliminado', S.undo ? { txt: 'Deshacer', fn: undo } : null);
        } catch (e) { toast('bad', '⛔', e.message); this.disabled = false; }
    });
}
function guardar(mid) { return api('/api/topologia/db/' + encodeURIComponent(mid), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.topos[mid]) }); }

/* ---------- exportación de inventario (nivel municipio) ---------- */
function normalizarEquipo(eq, ubicacion, munNombre) {
    return {
        id: eq.id, tipo: eq.tipo || 'pc',
        descripcion: eq.descripcion || eq.nombre || '',
        pr: eq.pr || '', sello: eq.sello || '', marca: eq.marca || '', modelo: eq.modelo || '',
        fecha_instalacion: eq.fecha_instalacion || '', ubicacion: ubicacion, municipio: munNombre,
        ip: eq.ip || '', tipo_gestion: eq.tipo_gestion || '', gestionable: !!eq.gestionable,
        velocidad_enlace: eq.velocidad_enlace || '',
        puertos_fibra: eq.puertos_fibra || 0, puertos_fibra_en_uso: eq.puertos_fibra_en_uso || 0,
        puertos_ethernet: eq.puertos_ethernet || 0, puertos_ethernet_en_uso: eq.puertos_ethernet_en_uso || 0,
        puerto_ethernet: eq.puerto_ethernet || 0, puerto_ethernet_en_uso: eq.puerto_ethernet_en_uso || 0,
        usa_adsl: !!eq.usa_adsl, prioridad: eq.prioridad || 'baja',
        sistemas_atiende: eq.sistemas_atiende || '', monitoreo: eq.monitoreo || 'ping'
    };
}
function recogerDelMunicipio(mid) {
    var out = [], m = geoDe(mid), munNombre = m ? m.nombre : mid;
    unidadesDe(mid).forEach(function (u) {
        var rec = function (obj, ruta) {
            var nombreObj = obj.descripcion || obj.nombre || '';
            var rutaActual = ruta ? ruta + ' > ' + nombreObj : nombreObj;
            [].concat(obj.equipos || [], obj.servicios || [], obj.pcs || []).forEach(function (e) { out.push(normalizarEquipo(e, rutaActual, munNombre)); });
            [].concat(obj.edificios || [], obj.locales || [], obj.sublocales || []).forEach(function (h) { rec(h, rutaActual); });
        };
        rec(u, '');
    });
    return out;
}
function descargarArchivo(contenido, nombre, mime) {
    var blob = new Blob([contenido], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
function exportarDesglose(fmt) {
    var lista = desgloseActual;
    if (!lista.length) { toast('warn', '⚠️', 'No hay equipos para exportar en este municipio.'); return; }
    var m = geoDe(S.foco.mun);
    var base = 'inventario_' + ((m ? m.nombre : 'municipio').replace(/[^a-zA-Z0-9_-]/g, '_')) + '_' + new Date().toISOString().slice(0, 10);
    if (fmt === 'xlsx') {
        if (typeof XLSX === 'undefined') { toast('bad', '⛔', 'Librería XLSX no cargada.'); return; }
        var filas = lista.map(function (e) {
            return {
                'ID': e.id, 'Tipo': e.tipo, 'Descripción': e.descripcion, 'PR / Código': e.pr,
                'Sello': e.sello, 'Marca': e.marca, 'Modelo': e.modelo,
                'Fecha instalación': e.fecha_instalacion ? String(e.fecha_instalacion).slice(0, 10) : '',
                'Ubicación': e.ubicacion, 'Municipio': e.municipio, 'IP': e.ip
            };
        });
        var ws = XLSX.utils.json_to_sheet(filas);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
        XLSX.writeFile(wb, base + '.xlsx');
        return;
    }
    if (fmt === 'oracle') {
        var lineas = ['\uFEFF"ID";"TIPO";"DESCRIPCION";"PR";"SELLO";"MARCA";"MODELO";"FECHA_INSTALACION";"UBICACION";"MUNICIPIO"'];
        lista.forEach(function (e) {
            var f = e.fecha_instalacion ? String(e.fecha_instalacion).slice(0, 10) : '';
            lineas.push([e.id, e.tipo, e.descripcion, e.pr, e.sello, e.marca, e.modelo, f, e.ubicacion, e.municipio]
                .map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(';'));
        });
        descargarArchivo(lineas.join('\n'), base + '.dat', 'text/csv;charset=utf-8');
        var ctl = '-- Archivo de control SQL*Loader\nOPTIONS (SKIP=1, ROWS=1000)\nLOAD DATA\nCHARACTERSET UTF8\nINFILE \'' + base + '.dat\'\nINTO TABLE INVENTARIO_FISICO_RIM\nFIELDS TERMINATED BY ";" OPTIONALLY ENCLOSED BY \'"\'\nTRAILING NULLCOLS\n(\n  ID, TIPO, DESCRIPCION, PR, SELLO, MARCA, MODELO, FECHA_INSTALACION DATE "YYYY-MM-DD", UBICACION, MUNICIPIO\n)\n';
        setTimeout(function () { descargarArchivo(ctl, 'inventario_fragmento.ctl', 'text/plain;charset=utf-8'); }, 300);
        return;
    }
    if (fmt === 'sql') {
        var sql = '-- Inventario de municipio — generado ' + new Date().toISOString() + '\n';
        lista.forEach(function (e) {
            var f = e.fecha_instalacion ? "TO_DATE('" + String(e.fecha_instalacion).slice(0, 10) + "', 'YYYY-MM-DD')" : 'NULL';
            function q(v) { return "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'"; }
            sql += 'INSERT INTO INVENTARIO_FISICO_RIM (ID, TIPO, DESCRIPCION, PR, SELLO, MARCA, MODELO, FECHA_INSTALACION, UBICACION, MUNICIPIO, FECHA_CARGA) VALUES (' +
                q(e.id) + ', ' + q(e.tipo) + ', ' + q(e.descripcion) + ', ' + q(e.pr) + ', ' + q(e.sello) + ', ' + q(e.marca) + ', ' + q(e.modelo) + ', ' + f + ', ' + q(e.ubicacion) + ', ' + q(e.municipio) + ', SYSDATE);\n';
        });
        sql += '\nCOMMIT;\n';
        descargarArchivo(sql, base + '.sql', 'text/plain;charset=utf-8');
    }
}
function abrirModalExportar() {
    desgloseActual = recogerDelMunicipio(S.foco.mun);
    var h = '<p style="margin-bottom:15px;color:#9fb3c8;">Elige el formato para exportar <strong>' + desgloseActual.length + ' equipo(s)</strong> de este municipio:</p>' +
        '<div class="f-row"><button type="button" class="mbtn wide" id="optXlsx">📥 Excel (.xlsx)</button></div>' +
        '<div class="f-row"><button type="button" class="mbtn wide" id="optOracle">🗄️ Oracle SQL*Loader (.dat + .ctl)</button></div>' +
        '<div class="f-row"><button type="button" class="mbtn wide" id="optSql">📜 SQL (.sql)</button></div>' +
        '<div class="f-actions"><button type="button" class="mbtn" id="btnCerrarExp">Cancelar</button></div>';
    abrirModal('📥 Exportar inventario del municipio', h);
    $('#optXlsx').addEventListener('click', function () { cerrarModal(); exportarDesglose('xlsx'); });
    $('#optOracle').addEventListener('click', function () { cerrarModal(); exportarDesglose('oracle'); });
    $('#optSql').addEventListener('click', function () { cerrarModal(); exportarDesglose('sql'); });
    $('#btnCerrarExp').addEventListener('click', cerrarModal);
}

/* ---------- toasts ---------- */
function toast(kind, ico, msg, acc) {
    var el = document.createElement('div'); el.className = 'toast ' + kind;
    el.innerHTML = '<span>' + ico + '</span><span>' + esc(msg) + '</span>';
    if (acc) { var b = document.createElement('button'); b.type = 'button'; b.textContent = acc.txt; b.addEventListener('click', function () { acc.fn(); quitar(); }); el.appendChild(b); }
    $('#toasts').appendChild(el);
    var t = setTimeout(quitar, acc ? 8000 : 3400);
    function quitar() { clearTimeout(t); el.classList.add('out'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260); }
}

/* ---------- init ---------- */
function initUI() {
    $('#btnFO').addEventListener('click', function () { modo('FO'); });
    $('#btnETH').addEventListener('click', function () { modo('Ethernet'); });
    $('#btnProvincia').addEventListener('click', provincia);
    $('#btnPanel').addEventListener('click', function () { location.href = '/private/admin.html'; });
    $('#btnSalir').addEventListener('click', function () { fetch('/api/logout', { method: 'POST' }).then(function () { location.href = '/'; }); });
    $('#inspClose').addEventListener('click', function () { $('#inspector').hidden = true; S.sel = null; S.connSel = null; renderAll(); });
    $('#legendToggle').addEventListener('click', function () { $('#legend').classList.toggle('closed'); });
    $('#modalX').addEventListener('click', cerrarModal);
    $('#scrim').addEventListener('click', function (e) { if (e.target === this) cerrarModal(); });
    $('#modeCancel').addEventListener('click', salirModo);
    if (!puedeEditar()) { $('#btnFO').hidden = true; $('#btnETH').hidden = true; $('#btnPanel').hidden = S.rol === 'operador'; }
    document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('#ctxMenu')) cerrarCtx(); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { if (!$('#scrim').hidden) cerrarModal(); else if (S.modo) salirModo(); else cerrarCtx(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    });
    window.addEventListener('beforeunload', function () { if (syncTimer) { clearTimeout(syncTimer); enviarDeltas(); } });
}
document.addEventListener('DOMContentLoaded', function () { safe(boot, 'boot'); });