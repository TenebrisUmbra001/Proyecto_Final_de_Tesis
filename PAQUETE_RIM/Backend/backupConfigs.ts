import { Client } from 'ssh2';
import { getTopologia } from './healthTests/monitor';
import { guardarConfigSwitch, getFechaUltimaConfig } from './db/db';

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

function comandoConfig(marca: string): string {
    const m = (marca || '').toLowerCase();
    if (m.includes('cisco')) return 'show running-config';
    return 'display current-configuration'; // Huawei / H3C / default
}

function recorrerSwitches(obj: any, acc: any[]) {
    if (obj.tipo === 'switch' && obj.gestionable && obj.tipo_gestion === 'SSH' && obj.ip) {
        acc.push({ id: obj.id, nombre: obj.descripcion || obj.nombre, ip: obj.ip, marca: obj.marca || '' });
    }
    const hijos = (obj.edificios || []).concat(obj.locales || [], obj.sublocales || [], obj.equipos || [], obj.servicios || [], obj.pcs || [], obj.unidades || []);
    for (const h of hijos) recorrerSwitches(h, acc);
}

export async function backupSwitch(sw: any): Promise<boolean> {
    return new Promise((resolve) => {
        const conn = new Client();
        let out = '';
        const timeout = setTimeout(() => { try { conn.end(); } catch (e) {} resolve(false); }, 30000);

        conn.on('ready', () => {
            conn.exec(comandoConfig(sw.marca), (err, stream) => {
                if (err) { clearTimeout(timeout); conn.end(); return resolve(false); }
                stream.on('data', (d: Buffer) => { out += d.toString('utf8'); });
                stream.stderr.on('data', (d: Buffer) => { out += d.toString('utf8'); });
                stream.on('close', () => {
                    clearTimeout(timeout);
                    conn.end();
                    guardarConfigSwitch(sw.id, sw.nombre, sw.ip, out).catch(() => {});
                    console.log(`💾 [BACKUP] Config guardada: ${sw.nombre} (${sw.ip})`);
                    resolve(true);
                });
            });
        });
        conn.on('error', () => { clearTimeout(timeout); resolve(false); });
        conn.connect({
            host: sw.ip, port: 22,
            username: process.env.SSH_USER, password: process.env.SSH_PASS,
            readyTimeout: 10000,
            algorithms: {
                kex: [
                    'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
                    'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha256',
                    'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1'
                ],
                serverHostKey: [
                    'ssh-rsa', 'ssh-dss', 'ssh-ed25519',
                    'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'
                ],
                cipher: [
                    'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
                    'aes128-gcm', 'aes128-gcm@openssh.com',
                    'aes256-gcm', 'aes256-gcm@openssh.com',
                    'aes256-cbc', 'aes192-cbc', 'aes128-cbc', '3des-cbc'
                ],
                hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1', 'hmac-md5']
            }
        });
    });
}

export async function verificarBackups() {
    const topo = getTopologia();
    if (!topo || !topo.municipios) return;
    const switches: any[] = [];
    for (const id of Object.keys(topo.municipios)) recorrerSwitches(topo.municipios[id], switches);
    console.log(`💾 [BACKUP] Revisando ${switches.length} switches SSH...`);
    for (const sw of switches) {
        const f = await getFechaUltimaConfig(sw.id);
        if (!f || (Date.now() - new Date(f).getTime()) > SEMANA_MS) {
            await backupSwitch(sw);
        }
    }
}

export function iniciarBackups() {
    setTimeout(verificarBackups, 60000);
    setInterval(verificarBackups, 12 * 60 * 60 * 1000);
    console.log('💾 [BACKUP] Respaldo semanal de configs activo (revisa cada 12h)');
}