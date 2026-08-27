import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '../Backups');
const RETENCION_DIAS = 7;

function pgDumpPath(): string {
    return process.env.PG_DUMP_PATH || 'pg_dump';
}

function nombreBackup(): string {
    const f = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `rim_backup_${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}_${pad(f.getHours())}${pad(f.getMinutes())}.sql`;
}

// 💾 Ejecuta pg_dump y guarda el respaldo
export function ejecutarBackupBD(): Promise<{ archivo: string; tamanio: number }> {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const archivo = path.join(BACKUP_DIR, nombreBackup());

        const args = [
            '-h', process.env.DB_HOST || 'localhost',
            '-p', process.env.DB_PORT || '5432',
            '-U', process.env.DB_USER || 'rim',
            '-d', process.env.DB_NAME || 'rim',
            '-f', archivo
        ];

        const env = Object.assign({}, process.env, { PGPASSWORD: process.env.DB_PASS || 'rim123' });

        execFile(pgDumpPath(), args, { env }, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ [BACKUP-BD] Error:', stderr || error.message);
                return reject(new Error(stderr || error.message));
            }
            const tamanio = fs.existsSync(archivo) ? fs.statSync(archivo).size : 0;
            console.log(`💾 [BACKUP-BD] Respaldo creado: ${path.basename(archivo)} (${tamanio} bytes)`);
            limpiarBackupsViejos();
            resolve({ archivo: path.basename(archivo), tamanio });
        });
    });
}

// 🗑️ Rotación: conserva solo los últimos 7 respaldos
function limpiarBackupsViejos() {
    try {
        const archivos = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('rim_backup_') && f.endsWith('.sql'))
            .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t);

        for (let i = RETENCION_DIAS; i < archivos.length; i++) {
            fs.unlinkSync(path.join(BACKUP_DIR, archivos[i].f));
            console.log(`🗑️ [BACKUP-BD] Respaldo viejo eliminado: ${archivos[i].f}`);
        }
    } catch (e) { /* no crítico */ }
}

// 📋 Lista respaldos existentes
export function listarBackupsBD() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('rim_backup_') && f.endsWith('.sql'))
        .map(f => {
            const st = fs.statSync(path.join(BACKUP_DIR, f));
            return { archivo: f, fecha: st.mtime, tamanio: st.size };
        })
        .sort((a: any, b: any) => b.fecha - a.fecha);
}

// 🔒 Valida el nombre del archivo (anti path traversal) antes de descargar
export function rutaBackup(archivo: string): string | null {
    if (!/^rim_backup_\d{4}-\d{2}-\d{2}_\d{4}\.sql$/.test(archivo)) return null;
    const p = path.join(BACKUP_DIR, archivo);
    return fs.existsSync(p) ? p : null;
}

// ⏰ Programa el respaldo diario a las 02:00
export function iniciarBackupsBD() {
    const ahora = new Date();
    const proxima = new Date(ahora);
    proxima.setHours(2, 0, 0, 0);
    if (proxima <= ahora) proxima.setDate(proxima.getDate() + 1);
    const ms = proxima.getTime() - ahora.getTime();

    setTimeout(() => {
        ejecutarBackupBD().catch(() => {});
        setInterval(() => ejecutarBackupBD().catch(() => {}), 24 * 60 * 60 * 1000);
    }, ms);

    console.log(`💾 [BACKUP-BD] Respaldo diario programado a las 02:00 (retención ${RETENCION_DIAS} días)`);
}