import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import session from 'express-session';
import http from 'http';

// Monitor
import { setTopologia, getEstados, iniciarMonitor, extraerRecursos } from './healthTests/monitor';
import { montarProxySSH } from './sshProxy';
import { iniciarBackups } from './backupConfigs'; // 🔧 corregido: sin .ts y con "s"
import { iniciarBackupsBD, ejecutarBackupBD, listarBackupsBD, rutaBackup } from './backupBD';
// BD
import {
    initDB,
    migrarUsuariosIniciales,
    getUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, cambiarPasswordUsuario,
    autenticarUsuario,
    getContactos, crearContacto, actualizarContacto, eliminarContacto,
    getAvisos,
    getAuditoria,
    listarConfigs, getConfig
} from './db/db';

// Servicios
import { enviarAlertaMonitoreo } from './EmailService/email';
import { leerTopologiaCompleta, guardarTopologiaCompleta, listarMunicipios } from './db/db';

dotenv.config();

const app = express();
app.use(express.json());

// 🛡️ Cabeceras de seguridad
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    next();
});

// ⚙️ Sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || 'mi-clave-secreta-muy-larga-y-segura',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 1000 * 60 * 60 * 2
    }
}));

app.use(express.static(path.join(__dirname, '../Fronted/public')));

function requiereLogin(req: any, res: any, next: any) {
    if (!req.session.usuario) return res.redirect('/');
    next();
}

function requiereRol(...rolesPermitidos: string[]) {
    return (req: any, res: any, next: any) => {
        if (!req.session.usuario) return res.redirect('/');
        if (!rolesPermitidos.includes(req.session.usuario.rol)) return res.status(403).send('❌ No tienes permiso');
        next();
    };
}

// ============================================================================
// 📡 API: Sesión
// ============================================================================
app.get('/api/sesion', requiereLogin, (req, res) => {
    res.json({
        id: (req.session as any).usuario.id,
        nombre: (req.session as any).usuario.nombre,
        rol: (req.session as any).usuario.rol
    });
});

const intentosLogin: Record<string, { count: number; bloqueadoHasta: number }> = {};
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;

app.post('/api/login', async (req, res) => {
    const ip = req.ip || 'desconocida';
    const ahora = Date.now();
    const reg = intentosLogin[ip] || { count: 0, bloqueadoHasta: 0 };

    if (reg.bloqueadoHasta > ahora) {
        const seg = Math.ceil((reg.bloqueadoHasta - ahora) / 1000);
        return res.status(429).json({ exito: false, mensaje: `Demasiados intentos. Espera ${seg}s.` });
    }

    const usuarioLimpio = String(req.body.usuario || '').trim().slice(0, 50);
    const contrasenaLimpia = String(req.body.contrasena || '').slice(0, 100);

    try {
        const u = await autenticarUsuario(usuarioLimpio, contrasenaLimpia);
        if (u) {
            delete intentosLogin[ip];
            // 🔧 Cast a any para evitar error de tipado con el campo id
            (req.session as any).usuario = { nombre: u.usuario, rol: u.rol, id: u.id };
            return res.json({ exito: true, mensaje: `Bienvenido ${u.nombre || u.usuario}`, rol: u.rol });
        }
    } catch (e) {
        return res.status(500).json({ exito: false, mensaje: 'Error en el servidor.' });
    }

    reg.count += 1;
    if (reg.count >= MAX_INTENTOS) { reg.bloqueadoHasta = ahora + BLOQUEO_MS; reg.count = 0; }
    intentosLogin[ip] = reg;
    res.status(401).json({ exito: false, mensaje: 'Usuario o Contraseña Incorrectos' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => { res.json({ exito: true }); });
});

app.post('/api/cambiar-password', requiereLogin, async (req, res) => {
    const err = await cambiarPasswordUsuario((req.session as any).usuario.id, req.body.actual, req.body.nueva);
    if (err) return res.status(400).json({ error: err });
    res.json({ exito: true });
});

// ============================================================================
// 🖧 API: Monitor
// ============================================================================
app.post('/api/topologia', requiereLogin, (req, res) => {
    setTopologia(req.body);
    res.json({ exito: true });
});

app.get('/api/estados', requiereLogin, (req, res) => {
    res.json(getEstados());
});

// ============================================================================
// 📄 Rutas privadas
// ============================================================================
app.get('/private/admin.html', requiereRol('admin', 'superadmin'), (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/admin.html'));
});
app.get('/private/operador.html', requiereRol('operador', 'admin', 'superadmin'), (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/operador.html'));
});
app.get('/private/superadmin.html', requiereRol('superadmin'), (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/superadmin.html'));
});
app.get('/private/mapa.html', requiereLogin, (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/mapa.html'));
});
app.get('/private/topologia.html', requiereLogin, (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/topologia.html'));
});

// ============================================================================
// 🛠️ API: Panel administrativo
// ============================================================================
app.get('/api/admin/usuarios', requiereRol('admin', 'superadmin'), async (req, res) => {
    res.json(await getUsuarios());
});
app.post('/api/admin/usuarios', requiereRol('superadmin'), async (req, res) => {
    try { res.json(await crearUsuario(req.body)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/usuarios/:id', requiereRol('superadmin'), async (req, res) => {
    try { res.json(await actualizarUsuario(parseInt(req.params.id, 10), req.body)); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/usuarios/:id', requiereRol('superadmin'), async (req, res) => {
    await eliminarUsuario(parseInt(req.params.id, 10));
    res.json({ exito: true });
});

app.get('/api/admin/equipos', requiereRol('admin', 'superadmin'), (req, res) => {
    const estados = getEstados();
    const lista = extraerRecursos().map((r: any) => ({
        id: r.id, tipo: r.tipo, nombre: r.nombre, ip: r.ip,
        municipio: r.municipio, municipioId: r.municipioId,
        prioridad: r.prioridad, gestion: r.gestionable ? r.tipo_gestion : null,
        estado: estados[r.id] ? (estados[r.id] as any).estado : 'desconocido'
    }));
    res.json(lista);
});

app.get('/api/admin/estadisticas', requiereRol('admin', 'superadmin'), (req, res) => {
    const estados = getEstados();
    const recursos = extraerRecursos();
    const st: any = {
        total: recursos.length,
        porTipo: {},
        porEstado: { online: 0, offline: 0, degradado: 0, desconocido: 0 },
        porMunicipio: {},
        eventosOk: 0, eventosTotal: 0
    };
    for (const r of recursos as any[]) {
        st.porTipo[r.tipo] = (st.porTipo[r.tipo] || 0) + 1;
        const e = (estados as any)[r.id] ? (estados as any)[r.id].estado : 'desconocido';
        st.porEstado[e] = (st.porEstado[e] || 0) + 1;
        if (!st.porMunicipio[r.municipio]) st.porMunicipio[r.municipio] = { total: 0, offline: 0 };
        st.porMunicipio[r.municipio].total++;
        if (e === 'offline') st.porMunicipio[r.municipio].offline++;
        const h = (estados as any)[r.id] && (estados as any)[r.id].historial ? (estados as any)[r.id].historial : [];
        for (const ev of h) { st.eventosTotal++; if (ev.ok) st.eventosOk++; }
    }
    st.disponibilidad = st.eventosTotal ? Math.round((100 * st.eventosOk) / st.eventosTotal) : 100;
    res.json(st);
});

app.get('/api/admin/contactos', requiereRol('admin', 'superadmin'), async (req, res) => {
    res.json(await getContactos());
});
app.post('/api/admin/contactos', requiereRol('admin', 'superadmin'), async (req, res) => {
    res.json(await crearContacto(req.body));
});
app.put('/api/admin/contactos/:id', requiereRol('admin', 'superadmin'), async (req, res) => {
    res.json(await actualizarContacto(parseInt(req.params.id, 10), req.body));
});
app.delete('/api/admin/contactos/:id', requiereRol('admin', 'superadmin'), async (req, res) => {
    await eliminarContacto(parseInt(req.params.id, 10));
    res.json({ exito: true });
});

app.get('/api/admin/avisos', requiereRol('admin', 'superadmin'), async (req, res) => {
    res.json(await getAvisos());
});
app.post('/api/admin/probar-correo', requiereRol('admin', 'superadmin'), async (req, res) => {
    const ok = await enviarAlertaMonitoreo(
        { nombre: 'Prueba de sistema', tipo: 'test', ip: '-', municipio: '-', prioridad: 'media' },
        'Correo de prueba enviado desde el panel administrativo.',
        [req.body.correo]);
    res.json({ exito: ok });
});

// 🔐 Auditoría SSH
app.get('/api/admin/auditoria', requiereRol('admin', 'superadmin'), async (req, res) => {
    res.json(await getAuditoria());
});
// 🗄️ Backups de la base de datos (solo superadmin)
app.post('/api/admin/backup-bd', requiereRol('superadmin'), async (req, res) => {
    try { res.json(await ejecutarBackupBD()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/backups-bd', requiereRol('superadmin'), (req, res) => {
    res.json(listarBackupsBD());
});

app.get('/api/admin/backups-bd/:archivo', requiereRol('superadmin'), (req, res) => {
    const p = rutaBackup(req.params.archivo);
    if (!p) return res.status(404).json({ error: 'Backup no encontrado' });
    res.download(p);
});
app.get('/api/admin/configs/:id/descargar', requiereRol('admin', 'superadmin'), async (req, res) => {
    try {
        const c = await getConfig(parseInt(req.params.id, 10));
        if (!c) return res.status(404).json({ error: 'Config no encontrada' });
        const nombre = (c.equipo_nombre || 'config').replace(/[^a-zA-Z0-9_-]/g, '_');
        const fecha = new Date(c.fecha).toISOString().slice(0, 19).replace(/:/g, '-');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre}_${fecha}.cfg"`);
        res.send(c.configuracion);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});
// 💾 Configs de switches
app.get('/api/admin/configs', requiereRol('admin', 'superadmin'), async (req, res) => {
    res.json(await listarConfigs());
});
app.get('/api/admin/configs/:id', requiereRol('admin', 'superadmin'), async (req, res) => {
    res.json(await getConfig(parseInt(req.params.id, 10)));
});

// 🗺️ BD: Topología
app.get('/api/municipios', requiereLogin, async (req, res) => {
    try { res.json(await listarMunicipios()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/topologia/db/:id', requiereLogin, async (req, res) => {
    try {
        const data = await leerTopologiaCompleta(req.params.id);
        if (!data) return res.status(404).json({ error: 'Municipio no encontrado' });
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.put('/api/topologia/db/:id', requiereLogin, async (req, res) => {
    try {
        await guardarTopologiaCompleta(req.params.id, req.body.nombre || 'Sin nombre', req.body);
        setTopologia({ municipios: { [req.params.id]: req.body } });
        res.json({ exito: true });
    } catch (e: any) {
        console.error('Error guardando topología:', e);
        res.status(500).json({ error: e.message });
    }
});

app.use('/private', requiereLogin, express.static(path.join(__dirname, '../Fronted/private')));

// ============================================================================
// 🚀 Arranque
// ============================================================================
initDB()
    .then(() => migrarUsuariosIniciales())
    .then(() => {
        iniciarMonitor();
        iniciarBackups();
        iniciarBackupsBD();   // 🔧 nuevo
    })
    .catch((e) => console.error('❌ [BD] Error al iniciar la base de datos:', e.message));

const PORT: number = parseInt(process.env.PORT || '2054', 10);
const server = http.createServer(app);
const host = '0.0.0.0';

montarProxySSH(server);

server.listen(PORT, host, () => {
    console.log(`✅ Servidor corriendo y escuchando en el puerto ${PORT}`);
    console.log(`   -> Local:   http://localhost:${PORT}`);
    console.log(`   -> Red LAN: http://172.72.34.110:${PORT}`);
    console.log(`📁 Sirviendo archivos desde: ${path.join(__dirname, '../Fronted')}`);
    console.log(`🔐 Proxy SSH WebSocket activo en /ssh-proxy`);
    console.log(`💾 Backup semanal de configs activo`);
});