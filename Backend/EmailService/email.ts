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

const transporter = nodemailer.createTransport(ZIMBRA_CONFIG);

transporter.verify((error, success) => {
    if (error) {
        console.error('❌ [EMAIL-INIT] Fallo al verificar Zimbra:', error.message);
    } else {
        console.log('✅ [EMAIL-INIT] Zimbra listo para enviar alertas');
    }
});

/**
 * Envía alerta de monitoreo (equipos caídos, BD con poco espacio, etc.)
 */
export async function enviarAlertaMonitoreo(recurso: any, detalle: string): Promise<boolean> {
    const destinatarios = (process.env.ALERTAS_CORREO || 'admin@das.pdr').split(',');
    
    try {
        const mailOptions = {
            from: `"Sistema de Monitoreo RIM" <${ZIMBRA_CONFIG.auth.user}>`,
            to: destinatarios,
            subject: `⚠️ Alerta: ${recurso.tipo.toUpperCase()} ${recurso.nombre} (${recurso.municipio})`,
            text: `ALERTA DE MONITOREO\n\nRecurso: ${recurso.nombre}\nTipo: ${recurso.tipo}\nIP: ${recurso.ip}\nMunicipio: ${recurso.municipio}\nPrioridad: ${recurso.prioridad}\n\nDetalle: ${detalle}\n\nHora: ${new Date().toLocaleString()}`,
            html: `
                <div style="font-family: Arial; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 500px; margin: auto; background: #f9f9f9;">
                    <div style="background: #e74c3c; padding: 10px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h2 style="color: white; margin: 0;">⚠️ Alerta de Monitoreo</h2>
                    </div>
                    <div style="padding: 20px; background: white; border-radius: 0 0 8px 8px;">
                        <p><strong>Recurso:</strong> ${recurso.nombre}</p>
                        <p><strong>Tipo:</strong> ${recurso.tipo}</p>
                        <p><strong>IP:</strong> ${recurso.ip}</p>
                        <p><strong>Municipio:</strong> ${recurso.municipio}</p>
                        <p><strong>Prioridad:</strong> ${recurso.prioridad}</p>
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                        <p><strong>Detalle:</strong><br>${detalle}</p>
                        <p style="color: #999; font-size: 12px; text-align: center;">${new Date().toLocaleString()}</p>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log('✅ [EMAIL] Alerta enviada a:', destinatarios);
        return true;
    } catch (error: any) {
        console.error('❌ [EMAIL] Error enviando alerta:', error.message);
        return false;
    }
}

export default { enviarAlertaMonitoreo };