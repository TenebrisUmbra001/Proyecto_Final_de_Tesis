import { getContactosParaPrioridad, registrarAviso } from '../db/db.ts';
import { enviarAlertaMonitoreo } from '../EmailService/email';
import { enviarSMS } from '../SmsService/sms';

export async function notificarSegunPrioridad(recurso: any, detalle: string): Promise<void> {
    const prio = recurso.prioridad || 'baja';
    if (prio === 'baja') return;

    let contactos: any[] = [];
    try { contactos = await getContactosParaPrioridad(prio); } catch (e) { contactos = []; }

    // Sin contactos en BD → fallback al .env
    if (contactos.length === 0) {
        if (prio === 'media' || prio === 'alta') {
            await enviarAlertaMonitoreo(recurso, detalle).catch(() => {});
            await registrarAviso(recurso, 'correo', process.env.ALERTAS_CORREO || '', detalle, prio);
        }
        if (prio === 'alta') {
            await enviarSMS(`ALERTA: ${recurso.nombre} (${recurso.ip}) - ${detalle}`).catch(() => {});
            await registrarAviso(recurso, 'sms', process.env.ALERTAS_SMS || '', detalle, prio);
        }
        return;
    }

    for (const c of contactos) {
        if (c.canal_correo && c.correo) {
            await enviarAlertaMonitoreo(recurso, detalle, [c.correo]).catch(() => {});
            await registrarAviso(recurso, 'correo', c.correo, detalle, prio);
        }
        if (c.canal_sms && c.telefono && prio === 'alta') {
            await enviarSMS(`ALERTA: ${recurso.nombre} (${recurso.ip}) - ${detalle}`).catch(() => {});
            await registrarAviso(recurso, 'sms', c.telefono, detalle, prio);
        }
    }
}