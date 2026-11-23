import * as fs from 'fs';
import { pool } from './db/db.ts';

// 🔧 Columna de id detectada en runtime (equipo_id o recurso_id, lo que exista)
let idCol: string | null = null;
let hasOk = false;
let hasNombre = false;
let hasMunicipio = false;
let hasFecha = true;

async function inspeccionar(): Promise<string[]> {
    const r = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'historial_estados'`
    );
    const names: string[] = r.rows.map((x: any) => x.column_name);
    if (names.indexOf('equipo_id') >= 0) idCol = 'equipo_id';
    else if (names.indexOf('recurso_id') >= 0) idCol = 'recurso_id';
    else idCol = null;
    hasOk = names.indexOf('ok') >= 0;
    hasNombre = names.indexOf('nombre') >= 0;
    hasMunicipio = names.indexOf('municipio') >= 0;
    hasFecha = names.indexOf('fecha') >= 0;
    return names;
}

export async function initHistorial() {
    await pool.query(`CREATE TABLE IF NOT EXISTS historial_estados (
        id SERIAL PRIMARY KEY,
        equipo_id VARCHAR(50) NOT NULL,
        estado VARCHAR(20) NOT NULL,
        detalle TEXT,
        latencia_ms INT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    const names = await inspeccionar();

    // Si la tabla existe pero no tiene ninguna columna de id reconocible, agregarla
    if (!idCol) {
        await pool.query(`ALTER TABLE historial_estados ADD COLUMN equipo_id VARCHAR(50)`);
        idCol = 'equipo_id';
    }
    // Asegurar columna de fecha (usada por rangos y purga)
    if (!hasFecha) {
        await pool.query(`ALTER TABLE historial_estados ADD COLUMN fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        hasFecha = true;
    }
    await pool.query(`ALTER TABLE historial_estados ADD COLUMN IF NOT EXISTS estado VARCHAR(20)`);

    console.log('✅ [HIST-BD] historial_estados listo (columna de id detectada: ' + idCol + ')');
}

export async function obtenerEventosRango(desde: number, hasta: number): Promise<any[]> {
    try {
        if (!idCol) await inspeccionar();
        if (!idCol) return [];

        // 🔧 SELECT dinámico: se adapta a las columnas que realmente existan
        const okExpr = hasOk ? 'ok' : `(COALESCE(estado, '') IN ('online', 'ok'))`;
        const tExpr = hasFecha ? `(EXTRACT(EPOCH FROM fecha)::float8 * 1000)` : '0';
        const whereExpr = hasFecha
            ? `fecha BETWEEN to_timestamp($1 / 1000.0) AND to_timestamp($2 / 1000.0)`
            : 'true';

        const sql = `SELECT ${idCol} AS equipo_id,
                            ${okExpr} AS ok,
                            ${tExpr} AS t,
                            ${hasNombre ? 'nombre' : 'NULL'} AS nombre,
                            ${hasMunicipio ? 'municipio' : 'NULL'} AS municipio,
                            estado, detalle, latencia_ms
                     FROM historial_estados
                     WHERE ${whereExpr}
                     ORDER BY fecha ASC
                     LIMIT 50000`;

        const r = await pool.query(sql, [desde, hasta]);
        return r.rows.map((x: any) => ({
            equipo_id: x.equipo_id,
            ok: !!x.ok,
            t: Number(x.t),
            nombre: x.nombre || null,
            municipio: x.municipio || null,
            estado: x.estado,
            detalle: x.detalle,
            latencia_ms: x.latencia_ms
        }));
    } catch (e: any) {
        // 🔧 Nunca romper la analítica: si algo falla, devolver vacío y loguear
        console.warn('⚠️ [HIST-BD] obtenerEventosRango falló (analítica degradada):', e.message);
        return [];
    }
}

export async function migrarDesdeJSON(ruta: string) {
    try {
        if (!fs.existsSync(ruta)) return;
        const raw = fs.readFileSync(ruta, 'utf8');
        const data = JSON.parse(raw);
        if (!Array.isArray(data) || data.length === 0) return;

        const count = await pool.query('SELECT COUNT(*) AS c FROM historial_estados');
        if (parseInt(count.rows[0].c, 10) > 0) return; // ya hay datos: no duplicar

        if (!idCol) await inspeccionar();
        if (!idCol) return;

        let insertados = 0;
        for (const ev of data) {
            const id = ev.equipo_id || ev.recurso_id || ev.equipoId || ev.recursoId || ev.id_equipo;
            if (!id) continue;
            const estado = ev.estado || (ev.ok ? 'online' : 'offline');
            const fecha = ev.fecha ? new Date(ev.fecha) : new Date();
            await pool.query(
                `INSERT INTO historial_estados (${idCol}, estado, detalle, latencia_ms, fecha)
                 VALUES ($1, $2, $3, $4, $5)`,
                [id, estado, ev.detalle || '', ev.latencia_ms || ev.latenciaMs || 0, fecha]
            );
            insertados++;
        }
        console.log(`✅ [HIST-BD] Migrados ${insertados} eventos desde JSON`);
    } catch (e: any) {
        console.warn('⚠️ [HIST-BD] migrarDesdeJSON falló (no bloquea arranque):', e.message);
    }
}

export async function purgarHistorial(dias: number): Promise<number> {
    try {
        const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
        const r = await pool.query(
            `DELETE FROM historial_estados WHERE fecha < to_timestamp($1 / 1000.0)`,
            [corte]
        );
        return r.rowCount || 0;
    } catch (e: any) {
        console.warn('⚠️ [HIST-BD] purgarHistorial falló:', e.message);
        return 0;
    }
}