import { Pool } from 'pg';

// 🔧 Cast a any: evita choques de tipos entre versiones de @types/pg
const pool: any = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'rim',
    password: process.env.DB_PASS || 'rim123',
    database: process.env.DB_NAME || 'rim'
});


const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  usuario VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  nombre VARCHAR(100),
  rol VARCHAR(20) NOT NULL DEFAULT 'operador',
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ultimo_login TIMESTAMP
);
CREATE TABLE IF NOT EXISTS municipios (
  id VARCHAR(50) PRIMARY KEY, nombre VARCHAR(100) NOT NULL
);
CREATE TABLE IF NOT EXISTS unidades (
  id VARCHAR(50) PRIMARY KEY,
  municipio_id VARCHAR(50) REFERENCES municipios(id) ON DELETE CASCADE,
  nombre VARCHAR(200), descripcion VARCHAR(200), x INT, y INT, width INT, height INT
);
CREATE TABLE IF NOT EXISTS edificios (
  id VARCHAR(50) PRIMARY KEY,
  unidad_id VARCHAR(50) REFERENCES unidades(id) ON DELETE CASCADE,
  nombre VARCHAR(200), descripcion VARCHAR(200), x INT, y INT, width INT, height INT
);
CREATE TABLE IF NOT EXISTS locales (
  id VARCHAR(50) PRIMARY KEY,
  edificio_id VARCHAR(50) REFERENCES edificios(id) ON DELETE CASCADE,
  padre_local_id VARCHAR(50) REFERENCES locales(id) ON DELETE CASCADE,
  nombre VARCHAR(200), descripcion VARCHAR(200), x INT, y INT, width INT, height INT
);
CREATE TABLE IF NOT EXISTS equipos (
  id VARCHAR(50) PRIMARY KEY,
  local_id VARCHAR(50) REFERENCES locales(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL, descripcion VARCHAR(200), pr VARCHAR(100), sello VARCHAR(100),
  marca VARCHAR(100), modelo VARCHAR(100), fecha_instalacion TIMESTAMP, ubicacion TEXT,
  ip VARCHAR(45), tipo_gestion VARCHAR(20), gestionable BOOLEAN, velocidad_enlace VARCHAR(20),
  puertos_fibra INT, puertos_fibra_en_uso INT, puertos_ethernet INT, puertos_ethernet_en_uso INT,
  puerto_ethernet INT, puerto_ethernet_en_uso INT, usa_adsl BOOLEAN,
  prioridad VARCHAR(10) DEFAULT 'baja', x INT, y INT, width INT, height INT
);
CREATE TABLE IF NOT EXISTS servicios (
  id VARCHAR(50) PRIMARY KEY,
  local_id VARCHAR(50) REFERENCES locales(id) ON DELETE CASCADE,
  tipo VARCHAR(20), descripcion VARCHAR(200), ip VARCHAR(45), prioridad VARCHAR(10) DEFAULT 'baja',
  x INT, y INT, width INT, height INT
);
CREATE TABLE IF NOT EXISTS pcs (
  id VARCHAR(50) PRIMARY KEY,
  local_id VARCHAR(50) REFERENCES locales(id) ON DELETE CASCADE,
  descripcion VARCHAR(200), pr VARCHAR(100), ip VARCHAR(45), sistemas_atiende TEXT,
  prioridad VARCHAR(10) DEFAULT 'baja', x INT, y INT, width INT, height INT
);
CREATE TABLE IF NOT EXISTS conexiones (
  id VARCHAR(50) PRIMARY KEY, desde_id VARCHAR(50) NOT NULL, hasta_id VARCHAR(50) NOT NULL,
  tipo VARCHAR(20), velocidad VARCHAR(20), puerto_desde INT, puerto_hasta INT
);
CREATE TABLE IF NOT EXISTS historial_estados (
  id SERIAL PRIMARY KEY, recurso_id VARCHAR(50) NOT NULL, estado VARCHAR(20) NOT NULL,
  detalle TEXT, latencia_ms INT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contactos_notificacion (
  id SERIAL PRIMARY KEY, nombre VARCHAR(100) NOT NULL, correo VARCHAR(150), telefono VARCHAR(20),
  activo BOOLEAN DEFAULT TRUE, canal_correo BOOLEAN DEFAULT TRUE, canal_sms BOOLEAN DEFAULT FALSE,
  prioridad_minima VARCHAR(10) DEFAULT 'media'
);
CREATE TABLE IF NOT EXISTS avisos_enviados (
  id SERIAL PRIMARY KEY, recurso_id VARCHAR(50), recurso_nombre VARCHAR(200), canal VARCHAR(10),
  destinatario VARCHAR(150), detalle TEXT, prioridad VARCHAR(10), fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auditoria_ssh (
  id SERIAL PRIMARY KEY, usuario_sistema VARCHAR(50), usuario_ssh VARCHAR(50),
  equipo_id VARCHAR(50), equipo_ip VARCHAR(45), inicio TIMESTAMP, fin TIMESTAMP
);
CREATE TABLE IF NOT EXISTS configs_switch (
  id SERIAL PRIMARY KEY,
  equipo_id VARCHAR(50), equipo_nombre VARCHAR(200), ip VARCHAR(45),
  configuracion TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export async function initDB() {
    await pool.query(ESQUEMA);
    console.log('✅ [BD] Esquema PostgreSQL listo');
}

// ---------- CONTACTOS ----------
export async function getContactos() {
    const r = await pool.query('SELECT * FROM contactos_notificacion ORDER BY nombre');
    return r.rows;
}

export async function getContactosParaPrioridad(prio: string) {
    const r = await pool.query(
        `SELECT * FROM contactos_notificacion WHERE activo = TRUE AND
         (($1 = 'alta') OR ($1 = 'media' AND prioridad_minima IN ('media','baja')))`, [prio]);
    return r.rows;
}

export async function crearContacto(c: any) {
    const r = await pool.query(
        `INSERT INTO contactos_notificacion (nombre, correo, telefono, activo, canal_correo, canal_sms, prioridad_minima)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [c.nombre, c.correo, c.telefono, c.activo, c.canal_correo, c.canal_sms, c.prioridad_minima]);
    return r.rows[0];
}

export async function actualizarContacto(id: number, c: any) {
    const r = await pool.query(
        `UPDATE contactos_notificacion SET nombre=$1, correo=$2, telefono=$3, activo=$4,
         canal_correo=$5, canal_sms=$6, prioridad_minima=$7 WHERE id=$8 RETURNING *`,
        [c.nombre, c.correo, c.telefono, c.activo, c.canal_correo, c.canal_sms, c.prioridad_minima, id]);
    return r.rows[0];
}

export async function eliminarContacto(id: number) {
    await pool.query('DELETE FROM contactos_notificacion WHERE id=$1', [id]);
}

// ---------- AVISOS ----------
export async function registrarAviso(recurso: any, canal: string, destinatario: string, detalle: string, prio: string) {
    await pool.query(
        `INSERT INTO avisos_enviados (recurso_id, recurso_nombre, canal, destinatario, detalle, prioridad)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [recurso.id, recurso.nombre, canal, destinatario, detalle, prio]).catch(() => { });
}

export async function getAvisos() {
    const r = await pool.query('SELECT * FROM avisos_enviados ORDER BY fecha DESC LIMIT 200');
    return r.rows;
}

// ---------- AUDITORÍA SSH ----------
export async function registrarSSHInicio(usuarioSistema: string, usuarioSsh: string, equipoId: string, ip: string) {
    const r = await pool.query(
        `INSERT INTO auditoria_ssh (usuario_sistema, usuario_ssh, equipo_id, equipo_ip, inicio)
         VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP) RETURNING id`, [usuarioSistema, usuarioSsh, equipoId, ip]);
    return r.rows[0] ? r.rows[0].id : null;
}

export async function registrarSSHFin(idAudit: number) {
    await pool.query('UPDATE auditoria_ssh SET fin = CURRENT_TIMESTAMP WHERE id=$1', [idAudit]).catch(() => { });
}

export async function getAuditoria() {
    const r = await pool.query('SELECT * FROM auditoria_ssh ORDER BY inicio DESC LIMIT 200');
    return r.rows;
}

// ---------- USUARIOS ----------
import bcrypt from 'bcrypt';

export async function getUsuarios() {
    const r = await pool.query('SELECT id, usuario, nombre, rol, activo, creado_en, ultimo_login FROM usuarios ORDER BY usuario');
    return r.rows;
}

export async function autenticarUsuario(usuario: string, pass: string) {
    const r = await pool.query(
        'SELECT id, usuario, nombre, rol, password_hash FROM usuarios WHERE LOWER(usuario) = LOWER($1) AND activo = TRUE',
        [usuario.trim()]);
    if (r.rows.length === 0) return null;
    const u = r.rows[0];
    const ok = await bcrypt.compare(pass, u.password_hash);
    if (!ok) return null;
    await pool.query('UPDATE usuarios SET ultimo_login = CURRENT_TIMESTAMP WHERE id = $1', [u.id]);
    return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
}

export async function crearUsuario(u: any) {
    const hash = await bcrypt.hash(u.password, 10);
    const activo = u.activo === undefined ? true : !!u.activo;
    const r = await pool.query(
        `INSERT INTO usuarios (usuario, password_hash, nombre, rol, activo)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, usuario, nombre, rol, activo`,
        [u.usuario, hash, u.nombre, u.rol, activo]);
    return r.rows[0];
}

export async function actualizarUsuario(id: number, u: any) {
    const campos: string[] = ['usuario', 'nombre', 'rol', 'activo'];
    const valores: any[] = [u.usuario, u.nombre, u.rol, u.activo];
    let sql = 'UPDATE usuarios SET ';
    for (let i = 0; i < campos.length; i++) sql += `${campos[i]} = $${i + 1}, `;
    if (u.password) {
        const hash = await bcrypt.hash(u.password, 10);
        sql += `password_hash = $${campos.length + 1}, `;
        valores.push(hash);
    }
    sql = sql.slice(0, -2) + ` WHERE id = $${valores.length + 1} RETURNING id, usuario, nombre, rol, activo`;
    valores.push(id);
    const r = await pool.query(sql, valores);
    return r.rows[0];
}

export async function eliminarUsuario(id: number) {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
}

export async function cambiarPasswordUsuario(id: number, passActual: string, passNueva: string): Promise<string | null> {
    const r = await pool.query('SELECT password_hash FROM usuarios WHERE id = $1', [id]);
    if (r.rows.length === 0) return 'Usuario no encontrado';
    const ok = await bcrypt.compare(passActual, r.rows[0].password_hash);
    if (!ok) return 'Contraseña actual incorrecta';
    const hash = await bcrypt.hash(passNueva, 10);
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, id]);
    return null;
}

// Migrar usuarios por defecto la primera vez (si la tabla está vacía)
export async function migrarUsuariosIniciales() {
    const r = await pool.query('SELECT COUNT(*) FROM usuarios');
    if (parseInt(r.rows[0].count, 10) > 0) return;
    const iniciales = [
        { usuario: 'Tenebris', password: '123456', nombre: 'Administrador Principal', rol: 'superadmin', activo: true },
        { usuario: 'admin', password: 'admin123', nombre: 'Administrador', rol: 'admin', activo: true },
        { usuario: 'operador', password: 'op123', nombre: 'Operador', rol: 'operador', activo: true }
    ];
    for (const u of iniciales) await crearUsuario(u);
    console.log('✅ [BD] Usuarios iniciales creados');
}

// ============================================================
// 🗺️ TOPOLOGÍA - Lectura completa de un municipio
// ============================================================
export async function leerTopologiaCompleta(municipioId: string) {
    const cliente = await pool.connect();
    try {
        const m = await cliente.query('SELECT * FROM municipios WHERE id = $1', [municipioId]);
        if (m.rows.length === 0) return null;
        const mun = m.rows[0];

        const unidades = (await cliente.query('SELECT * FROM unidades WHERE municipio_id = $1', [municipioId])).rows;
        const edificios = unidades.length ? (await cliente.query(
            'SELECT * FROM edificios WHERE unidad_id = ANY($1)', [unidades.map((u: any) => u.id)]
        )).rows : [];
        const locales = edificios.length ? (await cliente.query(
            'SELECT * FROM locales WHERE edificio_id = ANY($1) OR padre_local_id IN (SELECT id FROM locales WHERE edificio_id = ANY($1))',
            [edificios.map((e: any) => e.id)]
        )).rows : [];
        const equipos = locales.length ? (await cliente.query(
            'SELECT * FROM equipos WHERE local_id = ANY($1)', [locales.map((l: any) => l.id)]
        )).rows : [];
        const servicios = locales.length ? (await cliente.query(
            'SELECT * FROM servicios WHERE local_id = ANY($1)', [locales.map((l: any) => l.id)]
        )).rows : [];
        const pcs = locales.length ? (await cliente.query(
            'SELECT * FROM pcs WHERE local_id = ANY($1)', [locales.map((l: any) => l.id)]
        )).rows : [];

        const idsEntidades = [
            ...unidades.map((u: any) => u.id),
            ...edificios.map((e: any) => e.id),
            ...locales.map((l: any) => l.id),
            ...equipos.map((e: any) => e.id),
            ...servicios.map((s: any) => s.id),
            ...pcs.map((p: any) => p.id)
        ];
        const conexiones = idsEntidades.length ? (await cliente.query(
            'SELECT * FROM conexiones WHERE desde_id = ANY($1) OR hasta_id = ANY($1)',
            [idsEntidades]
        )).rows : [];

        const resultado: any = {
            nombre: mun.nombre,
            unidades: unidades.map((u: any) => reconstruirUnidad(u, edificios, locales, equipos, servicios, pcs))
        };
        resultado.conexiones = conexiones.map((c: any) => ({
            id: c.id, desde: c.desde_id, hasta: c.hasta_id,
            tipo: c.tipo, velocidad: c.velocidad,
            puertoDesde: c.puerto_desde, puertoHasta: c.puerto_hasta
        }));
        return resultado;
    } finally {
        cliente.release();
    }
}

function reconstruirUnidad(u: any, edificios: any[], locales: any[], equipos: any[], servicios: any[], pcs: any[]): any {
    return {
        id: u.id, tipo: 'unidad', nombre: u.nombre, descripcion: u.descripcion,
        x: u.x, y: u.y, width: u.width, height: u.height,
        edificios: edificios.filter(e => e.unidad_id === u.id).map(e =>
            reconstruirEdificio(e, locales, equipos, servicios, pcs))
    };
}

function reconstruirEdificio(e: any, locales: any[], equipos: any[], servicios: any[], pcs: any[]): any {
    return {
        id: e.id, tipo: 'edificio', nombre: e.nombre, descripcion: e.descripcion,
        x: e.x, y: e.y, width: e.width, height: e.height,
        locales: locales.filter(l => l.edificio_id === e.id && !l.padre_local_id)
            .map(l => reconstruirLocal(l, locales, equipos, servicios, pcs))
    };
}

function reconstruirLocal(l: any, todosLocales: any[], equipos: any[], servicios: any[], pcs: any[]): any {
    return {
        id: l.id, tipo: 'local', nombre: l.nombre, descripcion: l.descripcion,
        x: l.x, y: l.y, width: l.width, height: l.height,
        sublocales: todosLocales.filter(sl => sl.padre_local_id === l.id)
            .map(sl => reconstruirLocal(sl, todosLocales, equipos, servicios, pcs)),
        equipos: equipos.filter(eq => eq.local_id === l.id).map(eq => ({
            id: eq.id, tipo: eq.tipo, descripcion: eq.descripcion, nombre: eq.descripcion,
            pr: eq.pr, sello: eq.sello, marca: eq.marca, modelo: eq.modelo,
            fecha_instalacion: eq.fecha_instalacion, ubicacion: eq.ubicacion,
            ip: eq.ip, tipo_gestion: eq.tipo_gestion, gestionable: eq.gestionable,
            velocidad_enlace: eq.velocidad_enlace,
            puertos_fibra: eq.puertos_fibra, puertos_fibra_en_uso: eq.puertos_fibra_en_uso,
            puertos_ethernet: eq.puertos_ethernet, puertos_ethernet_en_uso: eq.puertos_ethernet_en_uso,
            puerto_ethernet: eq.puerto_ethernet, puerto_ethernet_en_uso: eq.puerto_ethernet_en_uso,
            usa_adsl: eq.usa_adsl, prioridad: eq.prioridad,
            x: eq.x, y: eq.y, width: eq.width, height: eq.height
        })),
        servicios: servicios.filter(s => s.local_id === l.id).map(s => ({
            id: s.id, tipo: s.tipo, descripcion: s.descripcion, nombre: s.descripcion,
            ip: s.ip, prioridad: s.prioridad,
            x: s.x, y: s.y, width: s.width, height: s.height
        })),
        pcs: pcs.filter(p => p.local_id === l.id).map(p => ({
            id: p.id, tipo: 'pc', descripcion: p.descripcion, nombre: p.descripcion,
            pr: p.pr, ip: p.ip, sistemas_atiende: p.sistemas_atiende, prioridad: p.prioridad,
            x: p.x, y: p.y, width: p.width, height: p.height
        }))
    };
}

// ============================================================
// 🗺️ TOPOLOGÍA - Guardado completo (reemplaza todo el municipio)
// ============================================================
export async function guardarTopologiaCompleta(municipioId: string, municipioNombre: string, datos: any) {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        await cliente.query(
            'INSERT INTO municipios (id, nombre) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET nombre = $2',
            [municipioId, municipioNombre]);

        await cliente.query('DELETE FROM unidades WHERE municipio_id = $1', [municipioId]);

        for (const unidad of (datos.unidades || [])) {
            await cliente.query(
                `INSERT INTO unidades (id, municipio_id, nombre, descripcion, x, y, width, height)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [unidad.id, municipioId, unidad.nombre || unidad.descripcion, unidad.descripcion, unidad.x, unidad.y, unidad.width, unidad.height]);

            for (const edificio of (unidad.edificios || [])) {
                await cliente.query(
                    `INSERT INTO edificios (id, unidad_id, nombre, descripcion, x, y, width, height)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [edificio.id, unidad.id, edificio.nombre || edificio.descripcion, edificio.descripcion, edificio.x, edificio.y, edificio.width, edificio.height]);

                for (const local of (edificio.locales || [])) {
                    await insertarLocalRecursivo(cliente, local, edificio.id, null);
                }
            }
        }

        for (const con of (datos.conexiones || [])) {
            await cliente.query(
                `INSERT INTO conexiones (id, desde_id, hasta_id, tipo, velocidad, puerto_desde, puerto_hasta)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [con.id, con.desde, con.hasta, con.tipo, con.velocidad, con.puertoDesde || null, con.puertoHasta || null]);
        }

        await cliente.query('COMMIT');
        return true;
    } catch (e) {
        await cliente.query('ROLLBACK');
        throw e;
    } finally {
        cliente.release();
    }
}

async function insertarLocalRecursivo(cliente: any, local: any, edificioId: string | null, padreLocalId: string | null) {
    await cliente.query(
        `INSERT INTO locales (id, edificio_id, padre_local_id, nombre, descripcion, x, y, width, height)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [local.id, edificioId, padreLocalId, local.nombre || local.descripcion, local.descripcion, local.x, local.y, local.width, local.height]);

    for (const eq of (local.equipos || [])) {
        await cliente.query(
            `INSERT INTO equipos (id, local_id, tipo, descripcion, pr, sello, marca, modelo, fecha_instalacion, ubicacion,
                ip, tipo_gestion, gestionable, velocidad_enlace,
                puertos_fibra, puertos_fibra_en_uso, puertos_ethernet, puertos_ethernet_en_uso,
                puerto_ethernet, puerto_ethernet_en_uso, usa_adsl, prioridad, x, y, width, height)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
            [eq.id, local.id, eq.tipo, eq.descripcion || eq.nombre, eq.pr, eq.sello, eq.marca, eq.modelo,
            eq.fecha_instalacion, eq.ubicacion, eq.ip, eq.tipo_gestion, eq.gestionable, eq.velocidad_enlace,
            eq.puertos_fibra, eq.puertos_fibra_en_uso, eq.puertos_ethernet, eq.puertos_ethernet_en_uso,
            eq.puerto_ethernet, eq.puerto_ethernet_en_uso, eq.usa_adsl, eq.prioridad || 'baja',
            eq.x, eq.y, eq.width, eq.height]);
    }

    for (const s of (local.servicios || [])) {
        await cliente.query(
            `INSERT INTO servicios (id, local_id, tipo, descripcion, ip, prioridad, x, y, width, height)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [s.id, local.id, s.tipo, s.descripcion || s.nombre, s.ip, s.prioridad || 'baja', s.x, s.y, s.width, s.height]);
    }

    for (const p of (local.pcs || [])) {
        await cliente.query(
            `INSERT INTO pcs (id, local_id, descripcion, pr, ip, sistemas_atiende, prioridad, x, y, width, height)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [p.id, local.id, p.descripcion || p.nombre, p.pr, p.ip, p.sistemas_atiende, p.prioridad || 'baja', p.x, p.y, p.width, p.height]);
    }

    for (const sub of (local.sublocales || [])) {
        await insertarLocalRecursivo(cliente, sub, null, local.id);
    }
}

export async function listarMunicipios() {
    const r = await pool.query('SELECT id, nombre FROM municipios ORDER BY nombre');
    return r.rows;
}

// ============================================================
// 💾 CONFIGS DE SWITCHES - Backup semanal
// ============================================================
export async function guardarConfigSwitch(equipoId: string, nombre: string, ip: string, config: string) {
    await pool.query('INSERT INTO configs_switch (equipo_id, equipo_nombre, ip, configuracion) VALUES ($1,$2,$3,$4)',
        [equipoId, nombre, ip, config]);
}

export async function getFechaUltimaConfig(equipoId: string) {
    const r = await pool.query('SELECT fecha FROM configs_switch WHERE equipo_id=$1 ORDER BY fecha DESC LIMIT 1', [equipoId]);
    return r.rows[0] ? r.rows[0].fecha : null;
}

export async function listarConfigs() {
    const r = await pool.query('SELECT id, equipo_id, equipo_nombre, ip, fecha, LENGTH(configuracion) AS tamanio FROM configs_switch ORDER BY fecha DESC LIMIT 100');
    return r.rows;
}

export async function getConfig(id: number) {
    const r = await pool.query('SELECT * FROM configs_switch WHERE id=$1', [id]);
    return r.rows[0];
}

export { pool };