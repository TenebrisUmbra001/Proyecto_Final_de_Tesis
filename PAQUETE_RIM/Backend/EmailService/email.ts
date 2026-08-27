import nodemailer from 'nodemailer';

const ZIMBRA_CONFIG = {
    host: process.env.SMTP_HOST || 'mail.das.pdr',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: true,
    auth: {
        user: process.env.SMTP_USER || 'no-reply@das.pdr',
        pass: process.env.SMTP_PASS || 'tu_contraseña_aqui'
    },
    tls: { rejectUnauthorized: false }
};

// 🔧 Cast a any: evita choques de tipado entre versiones de nodemailer
const transporter: any = nodemailer.createTransport(ZIMBRA_CONFIG);

transporter.on('error', (err: any) => {
    console.error('❌ [EMAIL-TRANSPORT] Error:', err.message);
});

transporter.verify(function (error: any, success: any) {
    if (error) {
        console.error('❌ [EMAIL-INIT] Fallo al verificar Zimbra:', error);
    } else {
        console.log('✅ [EMAIL-INIT] Zimbra listo para enviar alertas');
    }
});

export async function enviarAlertaMonitoreo(recurso: any, detalle: string, destinatarios?: string[]): Promise<boolean> {
    const para = destinatarios && destinatarios.length ? destinatarios
        : (process.env.ALERTAS_CORREO || 'admin@das.pdr').split(',');

    try {
        const mailOptions = {
            from: '"Sistema de Monitoreo RIM" <' + ZIMBRA_CONFIG.auth.user + '>',
            to: para,
            subject: '⚠️ Alerta: ' + (recurso.tipo || '').toUpperCase() + ' ' + recurso.nombre + ' (' + recurso.municipio + ')',
            text: 'ALERTA DE MONITOREO\n\n' +
                  'Recurso: ' + recurso.nombre + '\n' +
                  'Tipo: ' + recurso.tipo + '\n' +
                  'IP: ' + recurso.ip + '\n' +
                  'Municipio: ' + recurso.municipio + '\n' +
                  'Prioridad: ' + recurso.prioridad + '\n\n' +
                  'Detalle: ' + detalle + '\n\n' +
                  'Hora: ' + new Date().toLocaleString()
        };

        await transporter.sendMail(mailOptions);
        console.log('✅ [EMAIL] Alerta enviada a:', para);
        return true;
    } catch (error: any) {
        console.error('❌ [EMAIL] Error enviando alerta:', error.message);
        return false;
    }
}

export default { enviarAlertaMonitoreo };