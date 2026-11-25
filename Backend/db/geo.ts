// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pool } = require('pg');

// Mismo patrón que historialBD.ts: evita que los tipos de pg-pool (BoundPool)
// oculten query/connect. No requiere @types/pg ni cambios de tsconfig.
const pool: any = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'rim',
    password: process.env.DB_PASS || 'rim123',
    database: process.env.DB_NAME || 'rim',
    max: 5
});

export interface EstadoObjeto { locked: boolean; lat: number | null; lon: number | null; }
export interface EstadoEnlace { locked: boolean; puntos: number[][]; }
export interface CapaGeo { locks: Record<string, boolean>; pos: Record<string, number[]>; curvas: Record<string, number[][]>; }

export async function initGeoDB(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS geo_objetos (
            obj_id VARCHAR(80) PRIMARY KEY,
            locked BOOLEAN NOT NULL DEFAULT FALSE,
            lat DOUBLE PRECISION,
            lon DOUBLE PRECISION,
            actualizado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_por VARCHAR(60)
        );
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS geo_enlaces (
            con_id VARCHAR(80) PRIMARY KEY,
            locked BOOLEAN NOT NULL DEFAULT FALSE,
            puntos JSONB NOT NULL DEFAULT '[]'::jsonb,
            actualizado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            actualizado_por VARCHAR(60)
        );
    `);
    const a = await pool.query('SELECT COUNT(*)::int AS n FROM geo_objetos');
    const b = await pool.query('SELECT COUNT(*)::int AS n FROM geo_enlaces');
    console.log(`✅ [GEO] Capa geográfica lista · ${a.rows[0].n} objeto(s), ${b.rows[0].n} enlace(s)`);
}

function num(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function puntosValidos(v: any): number[][] {
    if (!Array.isArray(v)) return [];
    const out: number[][] = [];
    for (const p of v) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const lat = num(p[0]), lon = num(p[1]);
        if (lat === null || lon === null) continue;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
        out.push([lat, lon]);
    }
    return out;
}

/* ---------- lectura completa (formato idéntico al CAPA del cliente) ---------- */
export async function leerCapa(): Promise<CapaGeo> {
    const objs = await pool.query('SELECT obj_id, locked, lat, lon FROM geo_objetos');
    const ens = await pool.query('SELECT con_id, locked, puntos FROM geo_enlaces');
    const capa: CapaGeo = { locks: {}, pos: {}, curvas: {} };

    objs.rows.forEach((r: any) => {
        if (r.locked) capa.locks[r.obj_id] = true;
        const lat = num(r.lat), lon = num(r.lon);
        if (lat !== null && lon !== null) capa.pos[r.obj_id] = [lat, lon];
    });
    ens.rows.forEach((r: any) => {
        if (r.locked) capa.locks[r.con_id] = true;
        const p = puntosValidos(r.puntos);
        if (p.length) capa.curvas[r.con_id] = p;
    });
    return capa;
}

/* ---------- escritura de un objeto (estado completo, no patch) ---------- */
export async function guardarObjeto(id: string, e: EstadoObjeto, usuario: string | null): Promise<void> {
    const lat = num(e.lat), lon = num(e.lon);
    const vacio = !e.locked && lat === null && lon === null;
    if (vacio) { await pool.query('DELETE FROM geo_objetos WHERE obj_id = $1', [id]); return; }
    await pool.query(
        `INSERT INTO geo_objetos (obj_id, locked, lat, lon, actualizado, actualizado_por)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
         ON CONFLICT (obj_id) DO UPDATE
         SET locked = $2, lat = $3, lon = $4, actualizado = CURRENT_TIMESTAMP, actualizado_por = $5`,
        [id, !!e.locked, lat, lon, usuario]
    );
}

export async function borrarObjeto(id: string): Promise<void> {
    await pool.query('DELETE FROM geo_objetos WHERE obj_id = $1', [id]);
}

/* ---------- escritura de un enlace ---------- */
export async function guardarEnlace(id: string, e: EstadoEnlace, usuario: string | null): Promise<void> {
    const puntos = puntosValidos(e.puntos);
    const vacio = !e.locked && puntos.length === 0;
    if (vacio) { await pool.query('DELETE FROM geo_enlaces WHERE con_id = $1', [id]); return; }
    await pool.query(
        `INSERT INTO geo_enlaces (con_id, locked, puntos, actualizado, actualizado_por)
         VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP, $4)
         ON CONFLICT (con_id) DO UPDATE
         SET locked = $2, puntos = $3::jsonb, actualizado = CURRENT_TIMESTAMP, actualizado_por = $4`,
        [id, !!e.locked, JSON.stringify(puntos), usuario]
    );
}

export async function borrarEnlace(id: string): Promise<void> {
    await pool.query('DELETE FROM geo_enlaces WHERE con_id = $1', [id]);
}

/* ---------- migración masiva desde localStorage ---------- */
export async function migrarCapa(capa: CapaGeo, usuario: string | null): Promise<{ objetos: number; enlaces: number }> {
    const locks = capa.locks || {}, pos = capa.pos || {}, curvas = capa.curvas || {};

    // ids de enlace: los que tienen curvas registradas
    const esEnlace: Record<string, boolean> = {};
    Object.keys(curvas).forEach(k => { esEnlace[k] = true; });

    // ids de objeto: locks que no son de enlace, más todas las posiciones
    const idsObj: Record<string, boolean> = {};
    Object.keys(locks).forEach(k => { if (!esEnlace[k]) idsObj[k] = true; });
    Object.keys(pos).forEach(k => { idsObj[k] = true; });

    let nObj = 0, nEn = 0;
    const client: any = await pool.connect();
    try {
        await client.query('BEGIN');

        const objIds = Object.keys(idsObj);
        for (let i = 0; i < objIds.length; i++) {
            const id = objIds[i];
            const p = pos[id];
            const lat = p ? num(p[0]) : null, lon = p ? num(p[1]) : null;
            const locked = !!locks[id];
            if (!locked && lat === null && lon === null) continue;
            await client.query(
                `INSERT INTO geo_objetos (obj_id, locked, lat, lon, actualizado_por)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (obj_id) DO UPDATE
                 SET locked=$2, lat=$3, lon=$4, actualizado=CURRENT_TIMESTAMP, actualizado_por=$5`,
                [id, locked, lat, lon, usuario]);
            nObj++;
        }

        const enIds = Object.keys(esEnlace);
        for (let i = 0; i < enIds.length; i++) {
            const id = enIds[i];
            const puntos = puntosValidos(curvas[id]);
            const locked = !!locks[id];
            if (!locked && !puntos.length) continue;
            await client.query(
                `INSERT INTO geo_enlaces (con_id, locked, puntos, actualizado_por)
                 VALUES ($1,$2,$3::jsonb,$4)
                 ON CONFLICT (con_id) DO UPDATE
                 SET locked=$2, puntos=$3::jsonb, actualizado=CURRENT_TIMESTAMP, actualizado_por=$4`,
                [id, locked, JSON.stringify(puntos), usuario]);
            nEn++;
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    return { objetos: nObj, enlaces: nEn };
}

export async function estadisticasGeo(): Promise<any> {
    const o = await pool.query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE locked)::int AS bloqueados,
        COUNT(*) FILTER (WHERE lat IS NOT NULL)::int AS manuales FROM geo_objetos`);
    const e = await pool.query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE locked)::int AS bloqueados,
        COUNT(*) FILTER (WHERE jsonb_array_length(puntos) > 0)::int AS conCurva FROM geo_enlaces`);
    return { objetos: o.rows[0], enlaces: e.rows[0] };
}