import express from 'express';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config(); // Lee el .env de la raíz (si ejecutas desde la raíz)

const app = express();
app.use(express.json());

// Sirve tu frontend (HTML, CSS, JS) desde la carpeta public
app.use(express.static(path.join(__dirname, '../Fronted/public')));

// ✅ API de login: ahora las credenciales viven SOLO en el servidor
app.post('/api/login', (req, res) => {
    const { usuario, contrasena } = req.body;

    if (usuario === process.env.DevUser && contrasena === process.env.DevPass) {
        res.json({ exito: true, mensaje: `Bienvenido ${usuario}` });
    } else {
        res.status(401).json({ exito: false, mensaje: 'Usuario o Contraseña Incorrectos' });
    }
});

const PORT = process.env.PORT || 3000;
const Ip = procces.env.IpAddres || localhost;
app.listen(Ip,PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});