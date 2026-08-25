import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import session from 'express-session';
import http from 'http';
import { setTopologia, getEstados, iniciarMonitor } from './healthTests/monitor';
import { montarProxySSH } from './sshProxy';

dotenv.config();

const app = express();
app.use(express.json());

// 🛡️ Cabeceras de seguridad (anti clickjacking, MIME sniffing, XSS reflejado)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    next();
});

// ⚙️ Configuración de sesiones — DEBE ir ANTES de cualquier ruta que use req.session
app.use(session({
    secret: process.env.SESSION_SECRET || 'mi-clave-secreta-muy-larga-y-segura',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 1000 * 60 * 60 * 2 // 2 horas
    }
}));

// 🌐 Frontend público (login)
app.use(express.static(path.join(__dirname, '../Fronted/public')));

// 🚫 Middleware: protege rutas privadas
function requiereLogin(req: any, res: any, next: any) {
    if (!req.session.usuario) {
        return res.redirect('/');
    }
    next();
}

// 🛡️ Middleware: protege por rol específico
function requiereRol(...rolesPermitidos: string[]) {
    return (req: any, res: any, next: any) => {
        if (!req.session.usuario) {
            return res.redirect('/');
        }
        if (!rolesPermitidos.includes(req.session.usuario.rol)) {
            return res.status(403).send('❌ No tienes permiso para acceder a esta página');
        }
        next();
    };
}

// 📡 Sesión actual (para que el frontend sepa el rol)
app.get('/api/sesion', requiereLogin, (req, res) => {
    res.json({
        nombre: req.session.usuario!.nombre,
        rol: req.session.usuario!.rol
    });
});

// 🚦 Limitador de intentos de login (anti fuerza bruta)
const intentosLogin: Record<string, { count: number; bloqueadoHasta: number }> = {};
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000; // 5 min

// ✅ Login endpoint
app.post('/api/login', (req, res) => {
    const ip = req.ip || 'desconocida';
    const ahora = Date.now();
    const reg = intentosLogin[ip] || { count: 0, bloqueadoHasta: 0 };

    if (reg.bloqueadoHasta > ahora) {
        const seg = Math.ceil((reg.bloqueadoHasta - ahora) / 1000);
        return res.status(429).json({ exito: false, mensaje: `Demasiados intentos. Espera ${seg}s.` });
    }

    const usuarioLimpio = String(req.body.usuario || '').trim().toLowerCase().slice(0, 50);
    const contrasenaLimpia = String(req.body.contrasena || '').slice(0, 100);

    const usuarios = [
        { user: process.env.DevUser || 'Tenebris', pass: process.env.DevPass || '123456', rol: 'superadmin' },
        { user: 'admin', pass: 'admin123', rol: 'admin' },
        { user: 'operador', pass: 'op123', rol: 'operador' }
    ];

    const encontrado = usuarios.find(u => u.user.toLowerCase() === usuarioLimpio && u.pass === contrasenaLimpia);

    if (encontrado) {
        delete intentosLogin[ip];
        req.session.usuario = { nombre: encontrado.user, rol: encontrado.rol };
        res.json({ exito: true, mensaje: `Bienvenido ${encontrado.user}`, rol: encontrado.rol });
    } else {
        reg.count += 1;
        if (reg.count >= MAX_INTENTOS) {
            reg.bloqueadoHasta = ahora + BLOQUEO_MS;
            reg.count = 0;
        }
        intentosLogin[ip] = reg;
        res.status(401).json({ exito: false, mensaje: 'Usuario o Contraseña Incorrectos' });
    }
});

// 🚪 Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        res.json({ exito: true });
    });
});

// 🖧 MONITOR: el frontend sincroniza la topología
app.post('/api/topologia', requiereLogin, (req, res) => {
    setTopologia(req.body);
    res.json({ exito: true });
});

// 🖧 MONITOR: estados para pintar verde/rojo en el mapa
app.get('/api/estados', requiereLogin, (req, res) => {
    res.json(getEstados());
});

// 📄 Rutas privadas con control de rol específico
app.get('/private/admin.html', requiereRol('admin', 'superadmin'), (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/admin.html'));
});

app.get('/private/operador.html', requiereRol('operador', 'admin', 'superadmin'), (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/operador.html'));
});

app.get('/private/superadmin.html', requiereRol('superadmin'), (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/superadmin.html'));
});

// 🗺️ Rutas del sistema principal (mapa y topología) - solo requieren login
app.get('/private/mapa.html', requiereLogin, (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/mapa.html'));
});

app.get('/private/topologia.html', requiereLogin, (req, res) => {
    res.sendFile(path.join(__dirname, '../Fronted/private/topologia.html'));
});

// 📁 Todos los demás archivos en /private (CSS, JS, assets) protegidos con login
app.use('/private', requiereLogin, express.static(path.join(__dirname, '../Fronted/private')));

// 🖧 Arranca el monitor de salud (ciclos de 5 min + reintentos de 2 min)
iniciarMonitor();

const PORT: number = parseInt(process.env.PORT || '2054', 10);
const server = http.createServer(app);
const host = '0.0.0.0';

// 🔐 Montar proxy SSH WebSocket sobre el mismo servidor
montarProxySSH(server);

server.listen(PORT, host, () => {
    console.log(`✅ Servidor corriendo y escuchando en el puerto ${PORT}`);
    console.log(`   -> Local:   http://localhost:${PORT}`);
    console.log(`   -> Red LAN: http://172.72.34.110:${PORT}`);
    console.log(`📁 Sirviendo archivos desde: ${path.join(__dirname, '../Fronted')}`);
    console.log(`🔐 Proxy SSH WebSocket activo en /ssh-proxy`);
});