// descargar_tiles.js - versión iterativa, sin recursión
console.log('>>> SCRIPT ARRANCADO');

const https = require('https');
const fs = require('fs');
const path = require('path');

const DEST = path.join(__dirname, 'Fronted', 'private', 'tiles');
const ZOOMS = [9, 10, 11, 12, 13, 14];
const BBOX = { minLat: 21.90, maxLat: 23.10, minLon: -85.10, maxLon: -83.20 };

function lon2x(lon, zoom) { return Math.floor((lon + 180) / 360 * Math.pow(2, zoom)); }
function lat2y(lat, zoom) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)); }

// Construir lista de tiles pendientes (solo los que faltan o están corruptos)
let pendientes = [];
for (const z of ZOOMS) {
    const x0 = lon2x(BBOX.minLon, z), x1 = lon2x(BBOX.maxLon, z);
    const y0 = lat2y(BBOX.maxLat, z), y1 = lat2y(BBOX.minLat, z);
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            const file = path.join(DEST, String(z), String(x), y + '.png');
            if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
                pendientes.push({ z, x, y });
            }
        }
    }
}

console.log('>>> Tiles a procesar:', pendientes.length);
if (pendientes.length === 0) {
    console.log('✅ Todo listo, no hay tiles pendientes.');
    process.exit(0);
}

// 🔧 Bucle iterativo: procesa un tile a la vez, espera 1 segundo entre cada uno
let indice = 0;
let hechas = 0;
let fallos = 0;

function procesarSiguiente() {
    if (indice >= pendientes.length) {
        console.log(`✅ LISTO: ${hechas} nuevas, ${fallos} fallos.`);
        return;
    }
    const t = pendientes[indice++];
    const dir = path.join(DEST, String(t.z), String(t.x));
    const file = path.join(dir, t.y + '.png');
    
    fs.mkdirSync(dir, { recursive: true });
    
    const url = `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
    const req = https.get(url, { headers: { 'User-Agent': 'RIM-GeoMap/1.0 (educational)' } }, res => {
        if (res.statusCode !== 200) { 
            fallos++; 
            res.resume();
            if (indice % 100 === 0) console.log(`   ... ${indice}/${pendientes.length} (${fallos} fallos)`);
            setTimeout(procesarSiguiente, 1000);
            return; 
        }
        const ws = fs.createWriteStream(file);
        res.pipe(ws);
        ws.on('finish', () => { 
            hechas++; 
            if (indice % 100 === 0) console.log(`   ... ${indice}/${pendientes.length} (${hechas} ok, ${fallos} fallos)`);
            setTimeout(procesarSiguiente, 1000);
        });
        ws.on('error', () => { 
            fallos++; 
            setTimeout(procesarSiguiente, 1000); 
        });
    });
    req.on('error', e => { 
        fallos++; 
        setTimeout(procesarSiguiente, 1000); 
    });
    req.setTimeout(20000, () => { 
        req.destroy(); 
        fallos++; 
        setTimeout(procesarSiguiente, 1000); 
    });
}

// Arrancar el bucle
procesarSiguiente();