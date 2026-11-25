// descargar_tiles.js — bbox ampliado, rellena los huecos
console.log('>>> SCRIPT ARRANCADO (bbox ampliado)');

const https = require('https');
const fs = require('fs');
const path = require('path');

const DEST = path.join(__dirname, 'Fronted', 'private', 'tiles');

// 🔧 Zooms 9-13 con margen amplio: cubre todo el viewport en vista provincial y municipal
const ZOOMS = [9, 10, 11, 12, 13];
// 🔧 Margen generoso alrededor de Pinar del Río
const BBOX = { minLat: 21.55, maxLat: 23.35, minLon: -85.45, maxLon: -82.55 };

function lon2x(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
function lat2y(lat, z) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z)); }

let pendientes = [];
let yaTengo = 0;

for (const z of ZOOMS) {
    const x0 = lon2x(BBOX.minLon, z), x1 = lon2x(BBOX.maxLon, z);
    const y0 = lat2y(BBOX.maxLat, z), y1 = lat2y(BBOX.minLat, z);
    let nuevos = 0;
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            const file = path.join(DEST, String(z), String(x), y + '.png');
            if (fs.existsSync(file) && fs.statSync(file).size >= 1000) { yaTengo++; continue; }
            pendientes.push({ z, x, y });
            nuevos++;
        }
    }
    console.log('   z' + z + ': ' + nuevos + ' faltantes (x ' + x0 + '-' + x1 + ', y ' + y0 + '-' + y1 + ')');
}

console.log('>>> Ya tienes buenos: ' + yaTengo);
console.log('>>> Por descargar: ' + pendientes.length);

if (!pendientes.length) {
    console.log('✅ No falta nada. Todo completo.');
    process.exit(0);
}

let i = 0, ok = 0, fail = 0;
const t0 = Date.now();

function paso() {
    if (i >= pendientes.length) {
        const mins = ((Date.now() - t0) / 60000).toFixed(1);
        console.log('✅ LISTO: ' + ok + ' nuevas, ' + fail + ' fallos, en ' + mins + ' min.');
        if (fail > 0) console.log('   Vuelve a ejecutar el script para reintentar los fallos.');
        return;
    }
    const t = pendientes[i++];
    const dir = path.join(DEST, String(t.z), String(t.x));
    const file = path.join(dir, t.y + '.png');
    fs.mkdirSync(dir, { recursive: true });

    const url = 'https://tile.openstreetmap.org/' + t.z + '/' + t.x + '/' + t.y + '.png';
    const req = https.get(url, { headers: { 'User-Agent': 'RIM-GeoMap/1.0 (proyecto educativo interno)' } }, res => {
        if (res.statusCode !== 200) {
            fail++; res.resume();
            if (i % 100 === 0) log();
            setTimeout(paso, 500);
            return;
        }
        const ws = fs.createWriteStream(file);
        res.pipe(ws);
        ws.on('finish', () => { ok++; if (i % 100 === 0) log(); setTimeout(paso, 500); });
        ws.on('error', () => { fail++; setTimeout(paso, 500); });
    });
    req.on('error', e => { fail++; if (fail <= 5) console.log('   ERROR ' + e.code + ' z' + t.z); setTimeout(paso, 500); });
    req.setTimeout(20000, () => { req.destroy(); fail++; setTimeout(paso, 500); });
}

function log() {
    const pct = Math.round(i / pendientes.length * 100);
    const rest = Math.ceil((pendientes.length - i) * 0.5 / 60);
    console.log('   ' + i + '/' + pendientes.length + ' (' + pct + '%) · ' + ok + ' ok · ' + fail + ' fallos · ~' + rest + ' min restantes');
}

paso();