import { Client } from 'ssh2';
import { notificarSegunPrioridad } from './healthTests/notificador';

export interface DiskGroup {
    servidor: string;
    nombre: string;
    totalMB: number;
    libreMB: number;
    pctLibre: number;
    pctUsado: number;
    alerta: boolean;
}

let ultimoEstado: DiskGroup[] = [];
let ultimaEjecucion: number | null = null;
const alertasRecientes: Record<string, number> = {};

const UMBRAL = parseFloat(process.env.ASM_UMBRAL || '80');
const INTERVALO = parseInt(process.env.ASM_INTERVALO_MIN || '30', 10) * 60 * 1000;
const RE_ALERTA_MS = 6 * 60 * 60 * 1000; // no re-alertar el mismo DG antes de 6h

function servidores(): string[] {
    return (process.env.ASM_SERVIDORES || '').split(',').map(s => s.trim()).filter(Boolean);
}

function isNum(s: string): boolean { return /^\d+(\.\d+)?$/.test(s); }

//  Parsea la salida tabular de asmfree
export function parsearAsmFree(servidor: string, out: string): DiskGroup[] {
    const res: DiskGroup[] = [];
    const lineas = out.split(/\r?\n/);
    for (const ln of lineas) {
        const t = ln.trim().split(/\s+/);
        if (t.length < 5) continue;                       // salta encabezados/vacíos
        if (!isNum(t[1]) || !isNum(t[2]) || !isNum(t[3]) || !isNum(t[4])) continue; // salta separadores
        const pctUsado = parseFloat(t[4]);
        res.push({
            servidor,
            nombre: t[0],
            totalMB: parseFloat(t[1]),
            libreMB: parseFloat(t[2]),
            pctLibre: parseFloat(t[3]),
            pctUsado,
            alerta: pctUsado >= UMBRAL || ln.indexOf('!!') !== -1
        });
    }
    return res;
}

// 🔌 Ejecuta asmfree por SSH en el servidor
function ejecutarEnServidor(host: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let out = '';
        const script = process.env.ASM_SCRIPT_PATH || './asmfree';
        conn.on('ready', () => {
            conn.exec(script, (err, stream) => {
                if (err) { conn.end(); return reject(err); }
                stream.on('data', (d: Buffer) => { out += d.toString(); });
                stream.stderr.on('data', (d: Buffer) => { out += d.toString(); });
                stream.on('close', () => { conn.end(); resolve(out); });
            });
        });
        conn.on('error', (e) => reject(e));
        conn.connect({
            host, port: 22,
            username: process.env.ASM_SSH_USER || 'oracle',
            password: process.env.ASM_SSH_PASS || '',
            readyTimeout: 10000
        });
    });
}

// 🔄 Ciclo de chequeo de todos los servidores
export async function cicloAsm() {
    const todos: DiskGroup[] = [];
    for (const host of servidores()) {
        try {
            const out = await ejecutarEnServidor(host);
            todos.push(...parsearAsmFree(host, out));
        } catch (e: any) {
            console.error('[ASM] Error en ' + host + ': ' + e.message);
        }
    }
    ultimoEstado = todos;
    ultimaEjecucion = Date.now();

    // 🚨 Alertas con anti-spam
    for (const dg of todos) {
        const key = dg.servidor + '/' + dg.nombre;
        if (dg.alerta) {
            const prev = alertasRecientes[key] || 0;
            if (Date.now() - prev > RE_ALERTA_MS) {
                alertasRecientes[key] = Date.now();
                await notificarSegunPrioridad(
                    {
                        id: 'asm-' + key, tipo: 'oracle-asm',
                        nombre: 'ASM ' + dg.nombre + ' @ ' + dg.servidor,
                        ip: dg.servidor, municipio: '-', prioridad: 'alta'
                    } as any,
                    `DiskGroup ${dg.nombre} al ${dg.pctUsado}% de uso (umbral ${UMBRAL}%). ` +
                    `Libre: ${dg.libreMB} MB de ${dg.totalMB} MB.`
                );
            }
        } else {
            delete alertasRecientes[key]; // se liberó espacio, re-alerta si vuelve a subir
        }
    }
    console.log(`[ASM] Chequeo completo: ${todos.length} diskgroups en ${servidores().length} servidor(es)`);
}

export function getEstadoAsm() {
    return { diskgroups: ultimoEstado, ultimaEjecucion, umbral: UMBRAL };
}

export function iniciarOracleAsm() {
    if (!servidores().length) {
        console.log('[ASM] Sin servidores configurados (ASM_SERVIDORES vacío). Módulo en espera.');
        return;
    }
    setTimeout(cicloAsm, 15000);
    setInterval(cicloAsm, INTERVALO);
    console.log(`[ASM] Monitoreo ASM activo: ${servidores().join(', ')} | umbral ${UMBRAL}% | cada ${INTERVALO / 60000} min`);
}