import * as fs from 'fs';
import * as path from 'path';
import { ping, puertoTcp, sshCheck, dnsCheck } from './pruebas';
import { oracleCheck } from './oracle';
import { notificarSegunPrioridad } from './notificador';

export interface RecursoMonitoreo {
    id: string;
    tipo: string;
    nombre: string;
    ip: string;
    municipio: string;
    prioridad: string;
    gestionable?: boolean;
    puerto?: number;
    pcs?: { id: string; ip: string }[];
}

interface Estado {
    estado: 'online' | 'offline' | 'degradado' | 'desconocido';
    intentos: number;
    reintentoProgramado: boolean;
    ultimo: { t: number; ok: boolean; ms: number; detalle: string } | null;
    historial: { t: number; ok: boolean; ms: number; detalle: string }[];
}

let topologia: any = null;
const estados: Record<string, Estado> = {};

const INTERVALO_NORMAL = parseInt(process.env.MONITOR_INTERVALO_MIN || '5', 10) * 60 * 1000;
const INTERVALO_REINTENTO = parseInt(process.env.MONITOR_REINTENTO_MIN || '2', 10) * 60 * 1000;
const TOPO_FILE = path.join(__dirname, '../db/topologia_sync.json');
const PUERTOS_SERVICIO: Record<string, number> = {
    bd: 1521,
    dns: 53,
    firewall: 443,
    servidor: 22
};

export function setTopologia(t: any) {
    topologia = t;
    try {
        fs.writeFileSync(TOPO_FILE, JSON.stringify(t));
    } catch (e) {
        console.error('[MONITOR] No se pudo persistir topología:', e);
    }
}

export function getEstados() {
    return estados;
}

function buscarObjEnMun(id: string, mun: any): any {
    function rec(o: any): any {
        if (o.id === id) return o;
        const hijos = (o.edificios || []).concat(o.locales || [], o.sublocales || [], o.equipos || [], o.servicios || [], o.pcs || []);
        for (const h of hijos) {
            const r = rec(h);
            if (r) return r;
        }
        return null;
    }
    for (const u of (mun.unidades || [])) {
        const r = rec(u);
        if (r) return r;
    }
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
                if (a.tipo === 'switch' && b.tipo === 'pc') {
                    (pcsDeSwitch[a.id] = pcsDeSwitch[a.id] || []).push({ id: b.id, ip: b.ip });
                }
                if (b.tipo === 'switch' && a.tipo === 'pc') {
                    (pcsDeSwitch[b.id] = pcsDeSwitch[b.id] || []).push({ id: a.id, ip: a.ip });
                }
            }
        }

        const recLocal = (loc: any) => {
            for (const eq of (loc.equipos || [])) {
                if (!eq.ip) continue;
                lista.push({
                    id: eq.id,
                    tipo: eq.tipo,
                    nombre: eq.descripcion || eq.nombre || '',
                    ip: eq.ip,
                    municipio: mun.nombre,
                    prioridad: eq.prioridad || 'media',
                    gestionable: !!eq.gestionable,
                    pcs: pcsDeSwitch[eq.id] || []
                });
            }
            for (const sv of (loc.servicios || [])) {
                if (!sv.ip) continue;
                lista.push({
                    id: sv.id,
                    tipo: sv.tipo,
                    nombre: sv.descripcion || sv.nombre || '',
                    ip: sv.ip,
                    municipio: mun.nombre,
                    prioridad: sv.prioridad || 'alta',
                    puerto: sv.puerto || PUERTOS_SERVICIO[sv.tipo] || 22
                });
            }
            for (const pc of (loc.pcs || [])) {
                if (!pc.ip) continue;
                lista.push({
                    id: pc.id,
                    tipo: 'pc',
                    nombre: pc.descripcion || pc.nombre || '',
                    ip: pc.ip,
                    municipio: mun.nombre,
                    prioridad: pc.prioridad || 'baja'
                });
            }
            for (const sub of (loc.sublocales || [])) recLocal(sub);
        };

        for (const u of (mun.unidades || [])) {
            for (const e of (u.edificios || [])) {
                for (const l of (e.locales || [])) {
                    recLocal(l);
                }
            }
        }
    }
    return lista;
}

async function evaluarRecurso(r: RecursoMonitoreo): Promise<{ ok: boolean; detalle: string; ms: number }> {
    if (r.tipo === 'pc') {
        const p = await ping(r.ip);
        return p.ok ? { ok: true, detalle: 'ping ok', ms: p.ms } : { ok: false, detalle: 'sin respuesta a ping', ms: -1 };
    }

    if (r.tipo === 'switch' || r.tipo === 'modem' || r.tipo === 'transceiver') {
        const p = await ping(r.ip);
        if (p.ok) {
            if (r.gestionable) {
                const ssh = await sshCheck(r.ip);
                if (!ssh) {
                    return { ok: false, detalle: 'ping OK pero SSH (22) no responde: problema de conectividad/configuración', ms: p.ms };
                }
            }
            return { ok: true, detalle: 'ping ok' + (r.gestionable ? ' + ssh ok' : ''), ms: p.ms };
        }
        
        if (r.pcs && r.pcs.length > 0) {
            for (const pc of r.pcs) {
                const pp = await ping(pc.ip);
                if (pp.ok) {
                    return { ok: false, detalle: 'switch sin ping pero hay PCs vivas detrás (ICMP bloqueado o fallo parcial)', ms: -1 };
                }
            }
            return { ok: false, detalle: 'sin ping y TODAS sus PCs caídas → equipo intermedio caído/apagado', ms: -1 };
        }
        return { ok: false, detalle: 'sin respuesta a ping', ms: -1 };
    }

    if (r.tipo === 'dns') {
        const d = await dnsCheck(r.ip);
        return d ? { ok: true, detalle: 'resolución DNS ok', ms: 0 } : { ok: false, detalle: 'el DNS no resuelve', ms: -1 };
    }

    if (r.tipo === 'bd') {
        const o = await oracleCheck(r.ip, r.puerto);
        return { ok: o.ok, detalle: o.detalle, ms: 0 };
    }

    const t = await puertoTcp(r.ip, r.puerto || 22);
    return t
        ? { ok: true, detalle: 'puerto ' + (r.puerto || 22) + ' abierto', ms: 0 }
        : { ok: false, detalle: 'puerto ' + (r.puerto || 22) + ' cerrado', ms: -1 };
}

function registrar(id: string, res: { ok: boolean; detalle: string; ms: number }) {
    const est = estados[id] || (estados[id] = { estado: 'desconocido', intentos: 0, reintentoProgramado: false, ultimo: null, historial: [] });
    const ev = { t: Date.now(), ok: res.ok, ms: res.ms, detalle: res.detalle };
    est.ultimo = ev;
    est.historial.push(ev);
    if (est.historial.length > 500) est.historial.shift();
    return est;
}

function persistir() {
    try {
        const archivo = path.join(__dirname, '../db/historial_estados.json');
        fs.writeFileSync(archivo, JSON.stringify(estados, null, 2));
    } catch (e) {
        console.error('No se pudo guardar historial:', e);
    }
}

async function evaluarConReintento(r: RecursoMonitoreo) {
    const res = await evaluarRecurso(r);
    const est = registrar(r.id, res);

    if (res.ok) {
        est.estado = 'online';
        est.intentos = 0;
        return;
    }

    est.intentos++;
    if (!est.reintentoProgramado) {
        est.reintentoProgramado = true;
        console.log(`[MONITOR] Fallo en ${r.nombre} → reintento en 2 min`);
        
        setTimeout(async () => {
            est.reintentoProgramado = false;
            const res2 = await evaluarRecurso(r);
            registrar(r.id, res2);
            
            if (!res2.ok) {
                est.estado = 'offline';
                console.log(`[MONITOR] OFFLINE confirmado: ${r.nombre} (${r.ip})`);
                await notificarSegunPrioridad(r, res2.detalle);
            } else {
                est.estado = 'online';
                est.intentos = 0;
            }
            persistir();
        }, INTERVALO_REINTENTO);
    }
}

async function ciclo() {
    const recursos = extraerRecursos();
    console.log(`[MONITOR] Ciclo de chequeo: ${recursos.length} recursos`);
    
    for (const r of recursos) {
        try {
            await evaluarConReintento(r);
        } catch (e) {
            console.error('Error evaluando ' + r.id, e);
        }
    }
    persistir();
}

export function iniciarMonitor() {
    // 🔧 Recuperar topología persistida
    try {
        if (fs.existsSync(TOPO_FILE)) {
            topologia = JSON.parse(fs.readFileSync(TOPO_FILE, 'utf8'));
            console.log('[MONITOR] Topología recuperada desde disco');
        }
    } catch (e) {
        console.error('[MONITOR] No se pudo leer topología:', e);
    }

    // 🔧 Recuperar últimos estados conocidos (el mapa no queda gris al reiniciar)
    try {
        const HIST_FILE = path.join(__dirname, '../db/historial_estados.json');
        if (fs.existsSync(HIST_FILE)) {
            const prev = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'));
            var claves = Object.keys(prev);
            for (var i = 0; i < claves.length; i++) {
                prev[claves[i]].reintentoProgramado = false; // limpia flags viejos
                estados[claves[i]] = prev[claves[i]];
            }
            console.log('[MONITOR] Estados previos cargados: ' + claves.length);
        }
    } catch (e) {
        console.error('[MONITOR] No se pudo leer historial de estados:', e);
    }

    setTimeout(ciclo, 5000);
    setInterval(ciclo, INTERVALO_NORMAL);
    console.log('[MONITOR] Iniciado: ciclo ' + (INTERVALO_NORMAL / 60000) + ' min, reintento ' + (INTERVALO_REINTENTO / 60000) + ' min');
}