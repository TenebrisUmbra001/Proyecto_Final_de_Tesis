import { Client } from 'ssh2';
import { pool } from '../db/db';
import { notificarSegunPrioridad } from './notificador';

interface RecursoMonitor {
    id: string;
    tipo: string;
    nombre: string;
    ip: string;
    municipio: string;
    municipioId: string;
    prioridad: string;
    gestionable: boolean;
    tipo_gestion: string;
    monitoreo: string;
}

interface EstadoRecurso {
    ok: boolean | null;         // último estado confirmado
    ultima_verificacion: number;
    ms: number | null;
    intentos_fallidos: number;
    proximo_reintento: number;
    ultima_alerta_enviada: number;
}

let topologiaGlobal: any = { municipios: {} };
const estados: Record<string, EstadoRecurso> = {};

const INTERVALO_VERIFICACION_MS = 5 * 60 * 1000;   // ciclo base
const PRIMER_REINTENTO_MS = 45 * 60 * 1000;        // 1er fallo → 45min
const SEGUNDO_REINTENTO_MS = 5 * 60 * 1000;        // 2do fallo → 5min
const TERCER_REINTENTO_MS = 45 * 60 * 1000;        // 3er fallo confirmado → re-chequeo 45min
const MAX_INTENTOS_FALLIDOS = 3;
const VENTANA_SUPRESION_MS = 60 * 60 * 1000;       // 1 h sin re-alertar

export function setTopologia(t: any) { topologiaGlobal = t; }
export function setTopologiaMunicipio(id: string, datos: any) {
    if (!topologiaGlobal.municipios) topologiaGlobal.municipios = {};
    topologiaGlobal.municipios[id] = datos;
}
export function getTopologia() { return topologiaGlobal; }
export function getEstados() {
    // Normalizado para /api/estados (frontend espera { estado: 'online'|'offline'|'degradado' })
    const out: Record<string, any> = {};
    for (const id of Object.keys(estados)) {
        const s = estados[id];
        let estado: string = 'desconocido';
        if (s.ok === true) estado = 'online';
        else if (s.ok === false) estado = 'offline';
        else if (s.intentos_fallidos > 0) estado = 'degradado';
        out[id] = { estado, latencia_ms: s.ms, ultima_verificacion: s.ultima_verificacion };
    }
    return out;
}

function esIpPlaceholder(ip: string): boolean {
    if (!ip || !ip.trim()) return true;
    const t = ip.trim();
    return t === '1.1.1.1' || t === '0.0.0.0' || t === '255.255.255.255' || t.indexOf('127.') === 0;
}

// Inventario COMPLETO (panel, estadísticas, analítica)
export function extraerRecursos(): RecursoMonitor[] {
    const out: RecursoMonitor[] = [];
    const recorrer = (obj: any, munId: string, munNombre: string) => {
        if (obj.tipo === 'switch' || obj.tipo === 'modem' || obj.tipo === 'transceiver' ||
            obj.tipo === 'servidor' || obj.tipo === 'firewall' || obj.tipo === 'dns' ||
            obj.tipo === 'bd' || obj.tipo === 'pc') {
            out.push({
                id: obj.id,
                tipo: obj.tipo,
                nombre: obj.descripcion || obj.nombre || '',
                ip: obj.ip || '',
                municipio: munNombre,
                municipioId: munId,
                prioridad: obj.prioridad || 'baja',
                gestionable: !!obj.gestionable,
                tipo_gestion: obj.tipo_gestion || '',
                monitoreo: obj.monitoreo || 'ping'
            });
        }
        const hijos = [
            ...(obj.edificios || []), ...(obj.locales || []), ...(obj.sublocales || []),
            ...(obj.equipos || []), ...(obj.servicios || []), ...(obj.pcs || []), ...(obj.unidades || [])
        ];
        for (const h of hijos) recorrer(h, munId, munNombre);
    };
    for (const id of Object.keys(topologiaGlobal.municipios || {})) {
        const m = topologiaGlobal.municipios[id];
        for (const u of (m.unidades || [])) recorrer(u, id, m.nombre || id);
    }
    return out;
}

// Solo los que sí se chequean en el ciclo
export function extraerRecursosMonitoreables(): RecursoMonitor[] {
    return extraerRecursos().filter(r =>
        r.ip && !esIpPlaceholder(r.ip) && r.monitoreo !== 'ninguno'
    );
}

// 🔧 INSERT adaptado al esquema de tu historialBD.ts:
//    columnas: equipo_id, nombre, municipio, t (BIGINT), ok (BOOL), ms, detalle
async function registrarHistorialBD(r: RecursoMonitor, ok: boolean, ms: number, detalle: string) {
    try {
        await pool.query(
            `INSERT INTO historial_estados (equipo_id, nombre, municipio, t, ok, ms, detalle)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [r.id, r.nombre || null, r.municipio || null, Date.now(), ok, ms || 0, detalle]
        );
    } catch (e: any) {
        console.warn(`⚠️ [MONITOR] Fallo al registrar historial de ${r.id}: ${e.message}`);
    }
}

async function pingHost(ip: string, timeoutMs: number = 3000): Promise<{ ok: boolean; ms?: number }> {
    return new Promise((resolve) => {
        const start = Date.now();
        const { exec } = require('child_process');
        const cmd = process.platform === 'win32'
            ? `ping -n 1 -w ${timeoutMs} ${ip}`
            : `ping -c 1 -W ${Math.ceil(timeoutMs / 1000)} ${ip}`;
        exec(cmd, (error: any) => {
            const ms = Date.now() - start;
            resolve({ ok: !error, ms: error ? undefined : ms });
        });
    });
}

async function sshCheck(ip: string, user: string, pass: string): Promise<{ ok: boolean; ms?: number }> {
    return new Promise((resolve) => {
        const start = Date.now();
        const conn = new Client();
        const timeout = setTimeout(() => { try { conn.end(); } catch (e) {} resolve({ ok: false }); }, 8000);
        conn.on('ready', () => {
            const ms = Date.now() - start;
            clearTimeout(timeout);
            conn.end();
            resolve({ ok: true, ms });
        });
        conn.on('error', () => { clearTimeout(timeout); resolve({ ok: false }); });
        conn.connect({
            host: ip, port: 22, username: user, password: pass, readyTimeout: 8000,
            algorithms: {
                kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
                    'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha256',
                    'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1'],
                serverHostKey: ['ssh-rsa', 'ssh-dss', 'ssh-ed25519',
                    'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
                cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr',
                    'aes128-gcm', 'aes128-gcm@openssh.com', 'aes256-gcm', 'aes256-gcm@openssh.com',
                    'aes256-cbc', 'aes192-cbc', 'aes128-cbc', '3des-cbc'],
                hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1', 'hmac-md5']
            }
        });
    });
}

async function verificarRecurso(r: RecursoMonitor): Promise<void> {
    const ahora = Date.now();

    if (!estados[r.id]) {
        estados[r.id] = {
            ok: null,
            ultima_verificacion: 0,
            ms: null,
            intentos_fallidos: 0,
            proximo_reintento: 0,
            ultima_alerta_enviada: 0
        };
    }
    const st = estados[r.id];

    // Respetar ventanas de reintento
    if (ahora < st.proximo_reintento) return;

    let ok = false;
    let ms = 0;

    if (r.gestionable && r.tipo_gestion === 'SSH') {
        const result = await sshCheck(r.ip, process.env.SSH_USER || 'admin', process.env.SSH_PASS || '');
        ok = result.ok; ms = result.ms || 0;
        if (!ok) {
            const pingResult = await pingHost(r.ip);
            ok = pingResult.ok; ms = pingResult.ms || 0;
        }
    } else {
        const result = await pingHost(r.ip);
        ok = result.ok; ms = result.ms || 0;
    }

    st.ultima_verificacion = ahora;
    st.ms = ms || null;

    if (ok) {
        const estabaMal = st.ok === false;
        st.ok = true;
        st.intentos_fallidos = 0;
        st.proximo_reintento = 0;
        if (estabaMal) {
            await registrarHistorialBD(r, true, ms, 'Equipo recuperado');
            console.log(`✅ [MONITOR] ${r.nombre} (${r.ip}) RECUPERADO`);
        }
    } else {
        st.intentos_fallidos++;

        if (st.intentos_fallidos === 1) {
            st.proximo_reintento = ahora + PRIMER_REINTENTO_MS;
            console.log(`⚠️ [MONITOR] ${r.nombre} (${r.ip}) 1er fallo → sospechoso, reintento en 45min`);
        } else if (st.intentos_fallidos === 2) {
            st.proximo_reintento = ahora + SEGUNDO_REINTENTO_MS;
            console.log(`⚠️ [MONITOR] ${r.nombre} (${r.ip}) 2do fallo → reintento en 5min`);
        } else if (st.intentos_fallidos >= MAX_INTENTOS_FALLIDOS) {
            const estabaOk = st.ok !== false; // primera vez que confirmamos caída
            st.ok = false;
            st.proximo_reintento = ahora + TERCER_REINTENTO_MS;

            const desdeUltima = ahora - st.ultima_alerta_enviada;
            if (desdeUltima >= VENTANA_SUPRESION_MS) {
                if (estabaOk) {
                    console.log(`🔴 [MONITOR] ${r.nombre} (${r.ip}) OFFLINE CONFIRMADO (3 fallos)`);
                    await registrarHistorialBD(r, false, 0, 'Caída confirmada tras 3 intentos');
                    await notificarSegunPrioridad(r, 'Equipo sin conexión tras múltiples verificaciones');
                    st.ultima_alerta_enviada = ahora;
                } else {
                    console.log(`🔴 [MONITOR] ${r.nombre} (${r.ip}) sigue offline (alerta suprimida)`);
                }
            } else {
                console.log(`🔴 [MONITOR] ${r.nombre} (${r.ip}) offline (alerta suprimida, reciente)`);
            }
        }
    }
}

async function cicloMonitor() {
    const recursos = extraerRecursosMonitoreables();
    console.log(`🔍 [MONITOR] Verificando ${recursos.length} recursos monitoreables...`);
    const BATCH = 10;
    for (let i = 0; i < recursos.length; i += BATCH) {
        const batch = recursos.slice(i, i + BATCH);
        await Promise.all(batch.map(r => verificarRecurso(r).catch(() => {})));
    }
}

export async function iniciarMonitor() {
    console.log('🔍 [MONITOR] Iniciando monitoreo inteligente (3 strikes + supresión)');
    await cicloMonitor();
    setInterval(cicloMonitor, INTERVALO_VERIFICACION_MS);
}