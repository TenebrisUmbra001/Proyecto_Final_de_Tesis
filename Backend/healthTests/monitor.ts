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
    monitoreo: string; // 'ping' | 'inferido' | 'ninguno'
}

interface EstadoRecurso {
    estado: 'online' | 'offline' | 'degradado' | 'desconocido' | 'sospechoso';
    ultima_verificacion: number;
    latencia_ms: number | null;
    historial: Array<{ fecha: number; ok: boolean; ms?: number }>;
    // 🔧 NUEVO: Tracking de intentos fallidos
    intentos_fallidos: number;
    proximo_reintento: number; // timestamp
    ultima_alerta_enviada: number; // timestamp
}

let topologiaGlobal: any = { municipios: {} };
const estados: Record<string, EstadoRecurso> = {};

// 🔧 Configuración de reintentos
const INTERVALO_VERIFICACION_MS = 5 * 60 * 1000; // 5 min entre ciclos
const PRIMER_REINTENTO_MS = 45 * 60 * 1000; // 45 min después del primer fallo
const SEGUNDO_REINTENTO_MS = 5 * 60 * 1000; // 5 min después del segundo fallo
const TERCER_REINTENTO_MS = 45 * 60 * 1000; // 45 min después del tercer fallo
const MAX_INTENTOS_FALLIDOS = 3; // Después de 3 fallos consecutivos → OFFLINE
const VENTANA_SUPRESION_MS = 60 * 60 * 1000; // 1 hora sin re-alertar el mismo equipo

export function setTopologia(t: any) { topologiaGlobal = t; }
export function setTopologiaMunicipio(id: string, datos: any) {
    if (!topologiaGlobal.municipios) topologiaGlobal.municipios = {};
    topologiaGlobal.municipios[id] = datos;
}
export function getTopologia() { return topologiaGlobal; }
export function getEstados() { return estados; }

export function extraerRecursos(): RecursoMonitor[] {
    const out: RecursoMonitor[] = [];
    const recorrer = (obj: any, munId: string, munNombre: string) => {
        if (obj.tipo === 'switch' || obj.tipo === 'modem' || obj.tipo === 'transceiver' ||
            obj.tipo === 'servidor' || obj.tipo === 'firewall' || obj.tipo === 'dns' || obj.tipo === 'bd') {
            // 🔧 Solo monitorear si tiene IP y modo de monitoreo != 'ninguno'
            if (obj.ip && obj.monitoreo !== 'ninguno') {
                out.push({
                    id: obj.id,
                    tipo: obj.tipo,
                    nombre: obj.descripcion || obj.nombre || '',
                    ip: obj.ip,
                    municipio: munNombre,
                    municipioId: munId,
                    prioridad: obj.prioridad || 'baja',
                    gestionable: !!obj.gestionable,
                    tipo_gestion: obj.tipo_gestion || '',
                    monitoreo: obj.monitoreo || 'ping'
                });
            }
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

// 🔧 Ping con timeout configurable
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

// 🔧 SSH check (para switches gestionables)
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

// 🔧 Verificar un recurso individual con lógica de reintentos
async function verificarRecurso(r: RecursoMonitor): Promise<void> {
    const ahora = Date.now();
    
    // Inicializar estado si no existe
    if (!estados[r.id]) {
        estados[r.id] = {
            estado: 'desconocido',
            ultima_verificacion: 0,
            latencia_ms: null,
            historial: [],
            intentos_fallidos: 0,
            proximo_reintento: 0,
            ultima_alerta_enviada: 0
        };
    }
    
    const st = estados[r.id];
    
    // 🔧 Si está en "sospechoso" y aún no es hora del reintento, saltar
    if (st.estado === 'sospechoso' && ahora < st.proximo_reintento) {
        return;
    }
    
    let ok = false;
    let ms: number | undefined;
    
    // Modo de monitoreo
    if (r.monitoreo === 'inferido') {
        // Inferido: solo ping básico
        const result = await pingHost(r.ip);
        ok = result.ok;
        ms = result.ms;
    } else if (r.gestionable && r.tipo_gestion === 'SSH') {
        // SSH: intentar conexión completa
        const result = await sshCheck(r.ip, process.env.SSH_USER || 'admin', process.env.SSH_PASS || '');
        ok = result.ok;
        ms = result.ms;
        if (!ok) {
            // Fallback a ping si SSH falla
            const pingResult = await pingHost(r.ip);
            ok = pingResult.ok;
            ms = pingResult.ms;
        }
    } else {
        // Default: ping
        const result = await pingHost(r.ip);
        ok = result.ok;
        ms = result.ms;
    }
    
    // Actualizar historial (últimos 50 eventos)
    st.historial.push({ fecha: ahora, ok, ms });
    if (st.historial.length > 50) st.historial.shift();
    st.ultima_verificacion = ahora;
    st.latencia_ms = ms || null;
    
    // 🔧 LÓGICA DE REINTENTOS ESCALONADOS
    if (ok) {
        // ✅ Respondió: resetear todo
        const estabaOffline = st.estado === 'offline' || st.estado === 'sospechoso';
        st.estado = 'online';
        st.intentos_fallidos = 0;
        st.proximo_reintento = 0;
        
        // Si estaba offline y se recuperó, registrar recuperación
        if (estabaOffline) {
            await registrarHistorialBD(r.id, 'online', 'Equipo recuperado', ms || 0);
            console.log(`✅ [MONITOR] ${r.nombre} (${r.ip}) RECUPERADO`);
        }
    } else {
        // ❌ Falló: incrementar contador
        st.intentos_fallidos++;
        
        if (st.intentos_fallidos === 1) {
            // Primer fallo → "sospechoso", reintentar en 45 min
            st.estado = 'sospechoso';
            st.proximo_reintento = ahora + PRIMER_REINTENTO_MS;
            console.log(`⚠️ [MONITOR] ${r.nombre} (${r.ip}) - Primer fallo, reintentando en 45min`);
        } else if (st.intentos_fallidos === 2) {
            // Segundo fallo → sigue "sospechoso", reintentar en 5 min
            st.proximo_reintento = ahora + SEGUNDO_REINTENTO_MS;
            console.log(`⚠️ [MONITOR] ${r.nombre} (${r.ip}) - Segundo fallo, reintentando en 5min`);
        } else if (st.intentos_fallidos >= MAX_INTENTOS_FALLIDOS) {
            // Tercer fallo consecutivo → CONFIRMAR OFFLINE
            if (st.estado !== 'offline') {
                st.estado = 'offline';
                st.proximo_reintento = ahora + TERCER_REINTENTO_MS;
                
                // 🔧 SUPRESIÓN: Solo alertar si pasó más de 1 hora desde la última alerta
                const tiempoDesdeUltimaAlerta = ahora - st.ultima_alerta_enviada;
                if (tiempoDesdeUltimaAlerta >= VENTANA_SUPRESION_MS) {
                    console.log(`🔴 [MONITOR] ${r.nombre} (${r.ip}) - OFFLINE CONFIRMADO (3 fallos consecutivos)`);
                    await registrarHistorialBD(r.id, 'offline', 'Equipo caído (confirmado tras 3 intentos)', 0);
                    await notificarSegunPrioridad(r, `Equipo sin conexión tras múltiples intentos de verificación`);
                    st.ultima_alerta_enviada = ahora;
                } else {
                    console.log(`🔴 [MONITOR] ${r.nombre} (${r.ip}) - OFFLINE pero suprimido (alerta reciente)`);
                }
            } else {
                // Ya estaba offline, solo actualizar próximo reintento
                st.proximo_reintento = ahora + TERCER_REINTENTO_MS;
            }
        }
    }
    
    // Guardar en BD (solo cambios de estado importantes)
    if (ok && st.historial.length === 1) {
        await registrarHistorialBD(r.id, 'online', 'Primer check OK', ms || 0);
    }
}

async function registrarHistorialBD(recursoId: string, estado: string, detalle: string, latencia: number) {
    try {
        await pool.query(
            'INSERT INTO historial_estados (recurso_id, estado, detalle, latencia_ms) VALUES ($1, $2, $3, $4)',
            [recursoId, estado, detalle, latencia]
        );
    } catch (e) {
        console.error('Error registrando historial:', e);
    }
}

// 🔧 Ciclo principal de monitoreo
async function cicloMonitor() {
    const recursos = extraerRecursos();
    console.log(`🔍 [MONITOR] Verificando ${recursos.length} recursos...`);
    
    // Verificar en paralelo (máximo 10 simultáneos para no saturar)
    const BATCH_SIZE = 10;
    for (let i = 0; i < recursos.length; i += BATCH_SIZE) {
        const batch = recursos.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(r => verificarRecurso(r)));
    }
}

export async function iniciarMonitor() {
    console.log('🔍 [MONITOR] Iniciando ciclo de monitoreo inteligente con reintentos escalonados');
    await cicloMonitor();
    setInterval(cicloMonitor, INTERVALO_VERIFICACION_MS);
}

export async function purgarHistorial(dias: number): Promise<number> {
    const fecha = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const r = await pool.query('DELETE FROM historial_estados WHERE fecha < $1', [fecha]);
    return r.rowCount || 0;
}

export async function initHistorial() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS historial_estados (
            id SERIAL PRIMARY KEY,
            recurso_id VARCHAR(50) NOT NULL,
            estado VARCHAR(20) NOT NULL,
            detalle TEXT,
            latencia_ms INT,
            fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log('✅ [HIST-BD] Tabla historial_estados lista');
}

export async function migrarDesdeJSON(ruta: string): Promise<void> {
    const fs = require('fs');
    if (!fs.existsSync(ruta)) return;
    try {
        const data = JSON.parse(fs.readFileSync(ruta, 'utf8'));
        const r = await pool.query('SELECT COUNT(*) FROM historial_estados');
        if (parseInt(r.rows[0].count, 10) > 0) return;
        for (const ev of data) {
            await pool.query(
                'INSERT INTO historial_estados (recurso_id, estado, detalle, latencia_ms, fecha) VALUES ($1,$2,$3,$4,$5)',
                [ev.recursoId, ev.estado, ev.detalle || '', ev.latenciaMs || 0, new Date(ev.fecha)]
            );
        }
        console.log(`✅ [HIST-BD] Migrados ${data.length} eventos desde JSON`);
    } catch (e) { console.error('Error migrando historial JSON:', e); }
}