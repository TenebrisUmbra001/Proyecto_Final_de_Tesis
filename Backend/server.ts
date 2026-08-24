import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import session from 'express-session';

dotenv.config();

const app = express();
app.use(express.json());

// ⚙️ Configuración de sesiones
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
        return res.redirect('/'); // Redirige al login
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
        nombre: req.session.usuario.nombre, 
        rol: req.session.usuario.rol 
    });
});

// ✅ Login endpoint
app.post('/api/login', (req, res) => {
    const { usuario, contrasena } = req.body;

    const usuarioLimpio = usuario.trim().toLowerCase();
    const contrasenaLimpia = contrasena;

    const usuarios = [
        { user: process.env.DevUser || 'Tenebris', pass: process.env.DevPass || '123456', rol: 'superadmin' },
        { user: 'admin', pass: 'admin123', rol: 'admin' },
        { user: 'operador', pass: 'op123', rol: 'operador' }
    ];

    const encontrado = usuarios.find(u => 
        u.user.toLowerCase() === usuarioLimpio && 
        u.pass === contrasenaLimpia
    );

    if (encontrado) {
        req.session.usuario = {
            nombre: encontrado.user,
            rol: encontrado.rol
        };
        res.json({ 
            exito: true, 
            mensaje: `Bienvenido ${encontrado.user}`,
            rol: encontrado.rol
        });
    } else {
        res.status(401).json({ exito: false, mensaje: 'Usuario o Contraseña Incorrectos' });
    }
});

// 🚪 Logout endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        res.json({ exito: true });
    });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📁 Sirviendo archivos desde: ${path.join(__dirname, '../Fronted')}`);
});