import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pool } = require('pg');

const pool: any = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'rim',
    password: process.env.DB_PASS || 'rim123',
    database: process.env.DB_NAME || 'rim',
    max: 5
});

export async function initHistorial() {
    // Verificar si la tabla existe y tiene la estructura correcta
    const checkResult = await pool.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'historial_estados' AND column_name = 't'
    `);

    // Si la tabla existe pero no tiene la columna 't', eliminarla
    if (checkResult.rowCount === 0) {
        console.log('[HIST-BD] Tabla existente sin estructura correcta, recreando...');
        await pool.query(`DROP TABLE IF EXISTS historial_estados CASCADE;`);
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS historial_estados (
            id BIGSERIAL PRIMARY KEY,
            equipo_id TEXT NOT NULL,
            nombre TEXT,
            municipio TEXT,
            t BIGINT NOT NULL,
            ok BOOLEAN NOT NULL,
            ms INTEGER DEFAULT 0,
            detalle TEXT DEFAULT ''
        );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hist_t ON historial_estados(t);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_hist_equipo_t ON historial_estados(equipo_id, t);`);
    console.log('[HIST-BD] Tabla historial_estados lista');
}

// Inserta en lotes de 1000 para no exceder límites de parámetros
export async function insertarEventos(evts: any[]) {
    for (let i = 0; i < evts.length; i += 1000) {
        const lote = evts.slice(i, i + 1000);
        const values: string[] = [];
        const params: any[] = [];
        let p = 1;
        for (const e of lote) {
            values.push(`($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6})`);
            params.push(e.equipo_id, e.nombre || null, e.municipio || null, e.t, e.ok, e.ms || 0, e.detalle || '');
            p += 7;
        }
        await pool.query(`INSERT INTO historial_estados (equipo_id,nombre,municipio,t,ok,ms,detalle) VALUES ${values.join(',')}`, params);
    }
}

// 🔧 FIX: pg devuelve BIGINT como string → convertir t y ms a número
export async function obtenerEventosRango(desde: number, hasta: number) {
    const r = await pool.query(
        `SELECT equipo_id,nombre,municipio,t,ok,ms,detalle FROM historial_estados WHERE t>=$1 AND t<=$2 ORDER BY t ASC`,
        [desde, hasta]);
    return r.rows.map((row: any) => ({
        ...row,
        t: Number(row.t),
        ms: Number(row.ms)
    }));
}

// 🔧 FIX: normalizar t a número también aquí
export async function obtenerUltimosEstados() {
    const r = await pool.query(
        `SELECT DISTINCT ON (equipo_id) equipo_id,nombre,municipio,t,ok,detalle FROM historial_estados ORDER BY equipo_id, t DESC`);
    return r.rows.map((row: any) => ({
        ...row,
        t: Number(row.t)
    }));
}

export async function purgarHistorial(dias: number) {
    const corte = Date.now() - dias * 86400000;
    const r = await pool.query(`DELETE FROM historial_estados WHERE t < $1`, [corte]);
    return r.rowCount || 0;
}

export async function contarHistorial() {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM historial_estados`);
    return r.rows[0].n;
}

// Migra el JSON viejo a BD (solo si la tabla está vacía) y lo renombra
export async function migrarDesdeJSON(ruta: string) {
    if (!fs.existsSync(ruta)) return 0;
    const n = await contarHistorial();
    if (n > 0) return 0;
    try {
        const raw = JSON.parse(fs.readFileSync(ruta, 'utf8'));
        const evts: any[] = [];
        for (const id of Object.keys(raw)) {
            const hist = (raw[id] && raw[id].historial) || [];
            for (const ev of hist) {
                evts.push({ equipo_id: id, nombre: ev.nombre || null, municipio: ev.municipio || null, t: ev.t, ok: ev.ok, ms: ev.ms || 0, detalle: ev.detalle || '' });
            }
        }
        if (evts.length) await insertarEventos(evts);
        fs.renameSync(ruta, ruta + '.migrado');
        console.log(`[HIST-BD] Migrados ${evts.length} eventos desde JSON`);
        return evts.length;
    } catch (e: any) {
        console.error('[HIST-BD] Error migrando JSON:', e.message);
        return 0;
    }
}