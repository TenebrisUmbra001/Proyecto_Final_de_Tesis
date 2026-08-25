import { enviarAlertaMonitoreo } from '../EmailService/email.ts';
import { enviarSMS } from '../SmsService/sms';

export async function notificarSegunPrioridad(recurso: any, detalle: string): Promise<void> {
    const prio = recurso.prioridad || 'media';
    if (prio === 'baja') return;

    if (prio === 'media' || prio === 'alta') {
        await enviarAlertaMonitoreo(recurso, detalle).catch((e) => {
            console.error('Error enviando correo:', e);
        });
    }
    
    if (prio === 'alta') {
        await enviarSMS(`ALERTA: ${recurso.nombre} (${recurso.ip}) - ${detalle}`).catch((e) => {
            console.error('Error enviando SMS:', e);
        });
    }
}