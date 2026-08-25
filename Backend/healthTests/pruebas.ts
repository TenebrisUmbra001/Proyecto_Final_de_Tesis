import { exec } from 'child_process';
import * as net from 'net';
import * as dns from 'dns';

export function ping(ip: string, timeoutMs = 2000): Promise<{ ok: boolean; ms: number }> {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        const cmd = isWin
            ? `ping -n 1 -w ${timeoutMs} ${ip}`
            : `ping -c 1 -W ${Math.ceil(timeoutMs / 1000)} ${ip}`;
        
        const t0 = Date.now();
        exec(cmd, { timeout: timeoutMs + 1500 }, (error, stdout) => {
            const ms = Date.now() - t0;
            if (error) return resolve({ ok: false, ms: -1 });
            if (/100% loss|unreachable|destino inaccesible/i.test(stdout)) {
                return resolve({ ok: false, ms: -1 });
            }
            resolve({ ok: true, ms });
        });
    });
}

export function puertoTcp(ip: string, puerto: number, timeoutMs = 3000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.connect({ host: ip, port: puerto, timeout: timeoutMs });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
    });
}

export function sshCheck(ip: string): Promise<boolean> {
    return puertoTcp(ip, 22);
}

export function dnsCheck(ip: string): Promise<boolean> {
    return new Promise((resolve) => {
        const dominio = process.env.DNS_DOMINIO_PRUEBA || 'intranet.cu';
        const r = new dns.Resolver();
        r.setServers([ip]);
        const t = setTimeout(() => resolve(false), 3000);
        r.resolve4(dominio, (err) => {
            clearTimeout(t);
            resolve(!err);
        });
    });
}