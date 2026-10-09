import * as fs from 'fs';
import * as path from 'path';
import { ping, puertoTcp, sshCheck, dnsCheck } from './pruebas';
import { oracleCheck } from './oracle';
import { notificarSegunPrioridad } from './notificador';
import { insertarEventos, obtenerUltimosEstados } from '../historialBD';

export interface RecursoMonitoreo {
    id: string;
    tipo: string;
    nombre: string;
    ip: string;
    municipio: string;
    municipioId?: string;
    prioridad: string;
    gestionable?: boolean;
    puerto?: number;
    monitoreo?: string;   // 🔧 NUEVO: 'ping' | 'inferido' | 'ninguno'
    pcs?: { id: string; ip: string }[];
}

interface Estado {
    estado: 'online' | 'offline' | 'degradado' | 'desconocido' | 'excluido';   // 🔧 NUEVO: 'excluido'
    intentos: number;
    reintentoProgramado: boolean;
    ultimo: { t: number; ok: boolean; ms: number; detalle: string } | null;
    historial: { t: number; ok: boolean; ms: number; detalle: string }[];
}

let topologia: any = null;
const estados: Record<string, Estado> = {};
let bufferEventos: any[] = [];

const INTERVALO_NORMAL = parseInt(process.env.MONITOR_INTERVALO_MIN || '5', 10) * 60 * 1000;
const INTERVALO_REINTENTO = parseInt(process.env.MONITOR_REINTENTO_MIN || '2', 10) * 60 * 1000;
const TOPO_FILE = path.join(__dirname, '../db/topologia_sync.json');
const PUERTOS_SERVICIO: Record<string, number> = { bd: 1521, dns: 53, firewall: 443, servidor: 22 };

// 🔧 NUEVO: IPs que no deben chequearse (placeholder / inválidas)
function esIpPlaceholder(ip: string): boolean {
    if (!ip || !ip.trim()) return true;
    const t = ip.trim();
    return t === '1.1.1.1' || t === '0.0.0.0' || t === '255.255.255.255' || t.startsWith('127.');
}

export function setTopologia(t: any) {
    topologia = t;
    try { fs.writeFileSync(TOPO_FILE, JSON.stringify(t)); }
    catch (e) { console.error('[MONITOR] No se pudo persistir topología:', e); }
}

export function setTopologiaMunicipio(munId: string, datos: any) {
    if (!topologia) topologia = { municipios: {} };
    if (!topologia.municipios) topologia.municipios = {};
    topologia.municipios[munId] = datos;
    try { fs.writeFileSync(TOPO_FILE, JSON.stringify(topologia)); }
    catch (e) { console.error('[MONITOR] No se pudo persistir topología:', e); }
}

export function getEstados() { return estados; }
export function getTopologia() { return topologia; }

async function flushBuffer() {
    if (!bufferEventos.length) return;
    const lote = bufferEventos;
    bufferEventos = [];
    try {
        await insertarEventos(lote);
    } catch (e: any) {
        console.error('[MONITOR] Error guardando historial en BD, reintentando:', e.message);
        bufferEventos = lote.concat(bufferEventos);
        if (bufferEventos.length > 50000) bufferEventos = bufferEventos.slice(0, 50000);
    }
}

function buscarObjEnMun(id: string, mun: any): any {
    function rec(o: any): any {
        if (o.id === id) return o;
        const hijos = (o.edificios || []).concat(o.locales || [], o.sublocales || [], o.equipos || [], o.servicios || [], o.pcs || []);
        for (const h of hijos) { const r = rec(h); if (r) return r; }
        return null;
    }
    for (const u of (mun.unidades || [])) { const r = rec(u); if (r) return r; }
    return null;
}

export function extraerRecursos(): RecursoMonitoreo[] {
    const lista: RecursoMonitoreo[] = [];
    if (!topologia || !topologia.municipios) return lista;
    for (const munId of Object.keys(topologia.municipios)) {
        const mun = topologia.municipios[munId];
        const pcsDeSwitch: Record<string, { id: string; ip: string }[]> = {};
        for (const con of (mun.conexiones || [])) {
            const a = buscarObjEnMun(con.desde, mun);
            const b = buscarObjEnMun(con.hasta, mun);
            if (a && b) {
                if (a.tipo === 'switch' && b.tipo === 'pc') (pcsDeSwitch[a.id] = pcsDeSwitch[a.id] || []).push({ id: b.id, ip: b.ip });
                if (b.tipo === 'switch' && a.tipo === 'pc') (pcsDeSwitch[b.id] = pcsDeSwitch[b.id] || []).push({ id: a.id, ip: a.ip });
            }
        }
        const recLocal = (loc: any) => {
            for (const eq of (loc.equipos || [])) {
                // 🔧 NUEVO: calcular modo efectivo de monitoreo
                const modo = eq.monitoreo || 'ping';
                let efectivo = modo;
                if (esIpPlaceholder(eq.ip) && modo !== 'inferido') efectivo = 'ninguno';
                lista.push({
                    id: eq.id, tipo: eq.tipo, nombre: eq.descripcion || eq.nombre || '',
                    ip: eq.ip, municipio: mun.nombre, municipioId: munId,
                    prioridad: eq.prioridad || 'media', gestionable: !!eq.gestionable,
                    monitoreo: efectivo,   // 🔧 NUEVO
                    pcs: pcsDeSwitch[eq.id] || []
                });
            }
            for (const sv of (loc.servicios || [])) {
                if (!sv.ip) continue;
                lista.push({ id: sv.id, tipo: sv.tipo, nombre: sv.descripcion || sv.nombre || '', ip: sv.ip, municipio: mun.nombre, municipioId: munId, prioridad: sv.prioridad || 'alta', puerto: sv.puerto || PUERTOS_SERVICIO[sv.tipo] || 22 });
            }
            for (const pc of (loc.pcs || [])) {
                if (!pc.ip) continue;
                lista.push({ id: pc.id, tipo: 'pc', nombre: pc.descripcion || pc.nombre || '', ip: pc.ip, municipio: mun.nombre, municipioId: munId, prioridad: pc.prioridad || 'baja' });
            }
            for (const sub of (loc.sublocales || [])) recLocal(sub);
        };
        for (const u of (mun.unidades || [])) for (const e of (u.edificios || [])) for (const l of (e.locales || [])) recLocal(l);
    }
    return lista;
}

async function evaluarRecurso(r: RecursoMonitoreo): Promise<{ ok: boolean; detalle: string; ms: number; degradado?: boolean }> {
    if (r.tipo === 'pc') {
        const p = await ping(r.ip);
        return p.ok ? { ok: true, detalle: 'ping ok', ms: p.ms } : { ok: false, detalle: 'sin respuesta a ping', ms: -1 };
    }
    if (r.tipo === 'switch' || r.tipo === 'modem' || r.tipo === 'transceiver') {
        const p = await ping(r.ip);
        if (p.ok) {
            if (r.gestionable) {
                const ssh = await sshCheck(r.ip);
                if (!ssh) return { ok: true, degradado: true, detalle: 'ping OK pero SSH (22) no responde: equipo accesible, gestión caída', ms: p.ms };
            }
            return { ok: true, detalle: 'ping ok' + (r.gestionable ? ' + ssh ok' : ''), ms: p.ms };
        }
        if (r.pcs && r.pcs.length > 0) {
            for (const pc of r.pcs) { const pp = await ping(pc.ip); if (pp.ok) return { ok: false, detalle: 'switch sin ping pero hay PCs vivas detrás (ICMP bloqueado o fallo parcial)', ms: -1 }; }
            return { ok: false, detalle: 'sin ping y TODAS sus PCs caídas → equipo intermedio caído/apagado', ms: -1 };
        }
        return { ok: false, detalle: 'sin respuesta a ping', ms: -1 };
    }
    if (r.tipo === 'dns') { const d = await dnsCheck(r.ip); return d ? { ok: true, detalle: 'resolución DNS ok', ms: 0 } : { ok: false, detalle: 'el DNS no resuelve', ms: -1 }; }
    if (r.tipo === 'bd') { const o = await oracleCheck(r.ip, r.puerto); return { ok: o.ok, detalle: o.detalle, ms: 0 }; }
    const t = await puertoTcp(r.ip, r.puerto || 22);
    return t ? { ok: true, detalle: 'puerto ' + (r.puerto || 22) + ' abierto', ms: 0 } : { ok: false, detalle: 'puerto ' + (r.puerto || 22) + ' cerrado', ms: -1 };
}

function registrar(id: string, res: { ok: boolean; detalle: string; ms: number }, r?: RecursoMonitoreo) {
    const est = estados[id] || (estados[id] = { estado: 'desconocido', intentos: 0, reintentoProgramado: false, ultimo: null, historial: [] });
    const ev = { t: Date.now(), ok: res.ok, ms: res.ms, detalle: res.detalle };
    est.ultimo = ev;
    est.historial.push(ev);
    if (est.historial.length > 500) est.historial.shift();
    bufferEventos.push({ equipo_id: id, nombre: r ? r.nombre : null, municipio: r ? r.municipio : null, t: ev.t, ok: ev.ok, ms: ev.ms, detalle: ev.detalle });
    return est;
}

async function evaluarConReintento(r: RecursoMonitoreo) {
    const res = await evaluarRecurso(r);
    const est = registrar(r.id, res, r);
    if (res.ok) { est.estado = res.degradado ? 'degradado' : 'online'; est.intentos = 0; return; }
    est.intentos++;
    if (!est.reintentoProgramado) {
        est.reintentoProgramado = true;
        console.log(`[MONITOR] Fallo en ${r.nombre} → reintento en 2 min`);
        setTimeout(async () => {
            est.reintentoProgramado = false;
            const res2 = await evaluarRecurso(r);
            registrar(r.id, res2, r);
            if (!res2.ok) {
                est.estado = 'offline';
                console.log(`[MONITOR] OFFLINE confirmado: ${r.nombre} (${r.ip}) — ${res2.detalle}`);
                await notificarSegunPrioridad(r, res2.detalle);
            } else { est.estado = 'online'; est.intentos = 0; }
        }, INTERVALO_REINTENTO);
    }
}

// 🔧 NUEVO: Construye grafo de adyacencia desde conexiones
function construirAdyacencia(): Record<string, string[]> {
    const ady: Record<string, string[]> = {};
    if (!topologia || !topologia.municipios) return ady;
    for (const munId of Object.keys(topologia.municipios)) {
        for (const con of (topologia.municipios[munId].conexiones || [])) {
            (ady[con.desde] = ady[con.desde] || []).push(con.hasta);
            (ady[con.hasta] = ady[con.hasta] || []).push(con.desde);
        }
    }
    return ady;
}

// 🔧 NUEVO: Deduce estado de switches inferidos por sus vecinos
function aplicarInferencia(recursos: RecursoMonitoreo[], ady: Record<string, string[]>) {
    const pendientes = recursos.filter(r =>
        r.monitoreo === 'inferido' ||
        (!r.gestionable && r.monitoreo === 'ping' && estados[r.id] && estados[r.id].estado === 'desconocido'));

    for (let pasada = 0; pasada < 3; pasada++) {
        for (const r of pendientes) {
            const vec = ady[r.id] || [];
            let hayOnline = false, hayConcreto = false, todosOffline = true;
            for (const v of vec) {
                const st = estados[v] ? estados[v].estado : null;
                if (!st || st === 'desconocido' || st === 'excluido') continue;
                hayConcreto = true;
                if (st === 'online' || st === 'degradado') { hayOnline = true; todosOffline = false; }
                else if (st !== 'offline') { todosOffline = false; }
            }
                        let nuevo: 'online' | 'offline' | null = null;
            if (hayOnline) nuevo = 'online';
            else if (hayConcreto && todosOffline) nuevo = 'offline';
            if (nuevo) {
                const est = estados[r.id] || (estados[r.id] = { estado: 'desconocido', intentos: 0, reintentoProgramado: false, ultimo: null, historial: [] });
                if (est.estado !== nuevo) {
                    est.estado = nuevo;
                    if (nuevo === 'offline') notificarSegunPrioridad(r, 'Caída inferida: ningún equipo conectado detrás responde');
                }
            }
        }
    }
}

// 🔧 NUEVO: Ciclo con soporte para excluidos e inferencia
async function ciclo() {
    const recursos = extraerRecursos();
    const ady = construirAdyacencia();
    console.log(`[MONITOR] Ciclo de chequeo: ${recursos.length} recursos`);

    for (const r of recursos) {
        try {
            // 🔧 Excluidos: no se chequean, nunca salen como caídos
            if (r.monitoreo === 'ninguno') {
                estados[r.id] = estados[r.id] || { estado: 'excluido', intentos: 0, reintentoProgramado: false, ultimo: null, historial: [] };
                estados[r.id].estado = 'excluido';
                continue;
            }
            // 🔧 Inferidos puros: no se pinguean, se resuelven por vecinos
            if (r.monitoreo === 'inferido') continue;

            if (r.gestionable) {
                await evaluarConReintento(r);
            } else {
                // No gestionable: ping informativo; si falla se infiere, no se declara caído directo
                const res = await evaluarRecurso(r);
                const est = registrar(r.id, res, r);
                if (res.ok) { est.estado = res.degradado ? 'degradado' : 'online'; est.intentos = 0; }
                else { est.estado = 'desconocido'; }
            }
        } catch (e) { console.error('Error evaluando ' + r.id, e); }
    }
    aplicarInferencia(recursos, ady);
}

export async function iniciarMonitor() {
    try {
        if (fs.existsSync(TOPO_FILE)) { topologia = JSON.parse(fs.readFileSync(TOPO_FILE, 'utf8')); console.log('[MONITOR] Topología recuperada desde disco'); }
    } catch (e) { console.error('[MONITOR] No se pudo leer topología:', e); }

    try {
        const ultimos = await obtenerUltimosEstados();
        for (const u of ultimos) {
            estados[u.equipo_id] = {
                estado: u.ok ? 'online' : 'offline',
                intentos: 0, reintentoProgramado: false,
                ultimo: { t: u.t, ok: u.ok, ms: 0, detalle: u.detalle || '' },
                historial: []
            };
        }
        console.log('[MONITOR] Estados previos cargados desde BD: ' + ultimos.length);
    } catch (e) { console.error('[MONITOR] No se pudo cargar estados desde BD:', e); }

    setInterval(flushBuffer, 30000);
    setTimeout(ciclo, 5000);
    setInterval(ciclo, INTERVALO_NORMAL);
    console.log('[MONITOR] Iniciado: ciclo ' + (INTERVALO_NORMAL / 60000) + ' min, reintento ' + (INTERVALO_REINTENTO / 60000) + ' min');
}