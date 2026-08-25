import io from 'socket.io';
import { Client } from 'ssh2';

export function montarProxySSH(server: any) {
    // 🔧 Cast a any: los tipos de socket.io v2 no coinciden con los instalados
    const ioServer: any = (io as any)(server, {
        path: '/ssh-proxy',
        transports: ['websocket', 'polling']
    });

    ioServer.on('connection', (socket: any) => {
        console.log('[SSH-PROXY] Cliente conectado:', socket.id);
        let conn: Client | null = null;
        let auditInfo = { user: 'desconocido', host: '', inicio: new Date() };

        socket.on('ssh-connect', (data: { host: string; port?: number; user: string; pass: string }) => {
            auditInfo.host = data.host;
            auditInfo.user = data.user;
            console.log(`[SSH-AUDIT] ${auditInfo.user} → ${data.user}@${data.host}:${data.port || 22}`);

            conn = new Client();

            conn.on('ready', () => {
                socket.emit('ssh-ready');
                conn!.shell({ term: 'xterm-256color', cols: 120, rows: 30 }, (err: Error | undefined, stream: any) => {
                    if (err) {
                        socket.emit('ssh-error', 'No se pudo abrir shell: ' + err.message);
                        return;
                    }

                    stream.on('close', () => {
                        socket.emit('ssh-close', 'Conexión cerrada por el equipo remoto.');
                        socket.disconnect();
                    });

                    stream.on('data', (chunk: Buffer) => {
                        socket.emit('ssh-data', chunk.toString('utf8'));
                    });

                    socket.on('ssh-input', (text: string) => {
                        stream.write(text);
                    });

                    socket.on('ssh-resize', (size: { cols: number; rows: number }) => {
                        stream.setWindow(size.rows, size.cols, 0, 0);
                    });
                });
            });

            conn.on('error', (err: Error) => {
                socket.emit('ssh-error', 'Error SSH: ' + err.message);
                socket.disconnect();
            });

            conn.on('close', () => {
                socket.emit('ssh-close', 'El equipo remoto cerró la conexión.');
            });

            conn.connect({
                host: data.host,
                port: data.port || 22,
                username: data.user,
                password: data.pass,
                readyTimeout: 10000,
                keepaliveInterval: 10000,
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

        socket.on('disconnect', () => {
            if (conn) {
                try { conn.end(); } catch (e) {}
                conn = null;
            }
            console.log(`[SSH-AUDIT] Sesión cerrada → ${auditInfo.host}`);
        });
    });

    console.log('[SSH-PROXY] Proxy SSH WebSocket listo en /ssh-proxy');
}