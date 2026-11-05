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
        
        // 🔧 Aumentar timeout a 60 segundos para configs grandes
        const timeout = setTimeout(() => { 
            try { conn.end(); } catch (e) {} 
            resolve(false); 
        }, 60000);

        conn.on('ready', () => {
            // 🔧 Usar shell en lugar de exec para poder interactuar (enviar espacios si hay "More")
            conn.shell((err, stream) => {
                if (err) { 
                    clearTimeout(timeout); 
                    conn.end(); 
                    return resolve(false); 
                }
                
                let finished = false;

                stream.on('data', (d: Buffer) => {
                    const text = d.toString('utf8');
                    out += text;

                    // 🔧 Si el switch pausa la salida, enviar un espacio automáticamente para continuar
                    if (text.includes('---- More ----') || text.includes('--More--')) {
                        stream.write(' ');
                    }
                });

                stream.stderr.on('data', (d: Buffer) => {
                    out += d.toString('utf8');
                });

                stream.on('close', () => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        conn.end();
                        
                        // 🔧 Limpieza básica: quitar el eco de los comandos enviados
                        const cleanOut = out
                            .replace(/screen-length 0 temporary\r?\n/gi, '')
                            .replace(/display current-configuration\r?\n/gi, '')
                            .replace(/show running-config\r?\n/gi, '')
                            .trim();
                        
                        // Validar que trajo algo útil (más de 200 caracteres)
                        if (cleanOut.length > 200) { 
                            guardarConfigSwitch(sw.id, sw.nombre, sw.ip, cleanOut).catch(() => {});
                            console.log(`💾 [BACKUP] Config guardada: ${sw.nombre} (${sw.ip})`);
                            resolve(true);
                        } else {
                            console.warn(`⚠️ [BACKUP] Config muy corta o fallida para ${sw.nombre}. Longitud: ${cleanOut.length}`);
                            resolve(false);
                        }
                    }
                });

                // 🔧 NUEVO: Intentar desactivar paginación primero (funciona en Huawei/H3C y muchos otros)
                stream.write('screen-length 0 temporary\n');
                
                setTimeout(() => {
                    // Enviar el comando de configuración
                    stream.write(comandoConfig(sw.marca) + '\n');
                    
                    // 🔧 Cerrar la conexión después de un tiempo prudencial 
                    // (algunos switches no cierran el shell automáticamente después del comando)
                    setTimeout(() => {
                        if (!finished) {
                            stream.end();
                        }
                    }, 15000); // 15 segundos después de enviar el comando es más que suficiente
                    
                }, 1000); // Esperar 1 segundo después de enviar screen-length
            });
        });

        conn.on('error', () => { 
            clearTimeout(timeout); 
            resolve(false); 
        });

        conn.connect({
            host: sw.ip, port: 22,
            username: process.env.SSH_USER, password: process.env.SSH_PASS,
            readyTimeout: 15000, // Aumentado a 15s para conexiones lentas
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