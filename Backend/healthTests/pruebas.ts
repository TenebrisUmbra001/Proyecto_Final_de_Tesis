import { execFile } from 'child_process';
import * as net from 'net';
import * as dns from 'dns';

// 🌐 PING independiente del idioma del SO (usa el marcador TTL, no el texto)
export function ping(ip: string): Promise<{ ok: boolean; ms: number }> {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        const args = isWin ? ['-n', '2', '-w', '1500', ip] : ['-c', '2', '-W', '2', ip];
        const t0 = Date.now();
        execFile('ping', args, { timeout: 8000 }, (error, stdout) => {
            const out = String(stdout || '');
            // TTL solo aparece si hubo respuesta real (en cualquier idioma)
            const ok = /TTL=/i.test(out);
            const m = /(?:tiempo|time)[=<](\d+)ms/i.exec(out);
            resolve({ ok: ok, ms: m ? parseInt(m[1], 10) : Date.now() - t0 });
        });
    });
}

// 🔌 Puerto TCP abierto?
export function puertoTcp(ip: string, puerto: number, timeoutMs = 3000): Promise<boolean> {
    return new Promise((resolve) => {
        let listo = false;
        const fin = (v: boolean) => { if (!listo) { listo = true; resolve(v); } };
        const s = net.connect({ host: ip, port: puerto, timeout: timeoutMs });
        s.once('connect', () => { s.destroy(); fin(true); });
        s.once('timeout', () => { s.destroy(); fin(false); });
        s.once('error', () => { s.destroy(); fin(false); });
    });
}

// 🔐 SSH = puerto 22 abierto
export function sshCheck(ip: string): Promise<boolean> {
    return puertoTcp(ip, 22);
}

// 🌍 El servidor DNS resuelve?
export function dnsCheck(servidor: string): Promise<boolean> {
    const dominio = process.env.DNS_DOMINIO_PRUEBA || 'google.com';
    return new Promise((resolve) => {
        let listo = false;
        const fin = (v: boolean) => { if (!listo) { listo = true; resolve(v); } };
        const r = new dns.Resolver();
        r.setServers([servidor]);
        r.resolve4(dominio, (err) => fin(!err));
        setTimeout(() => fin(false), 4000);
    });
}