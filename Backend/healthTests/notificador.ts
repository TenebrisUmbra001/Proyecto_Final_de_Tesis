import { getContactosParaPrioridad, registrarAviso } from '../db/db.ts';
import { enviarAlertaMonitoreo } from '../EmailService/email';
import { enviarSMS } from '../SmsService/sms';

export async function notificarSegunPrioridad(recurso: any, detalle: string): Promise<void> {
    const prio = recurso.prioridad || 'baja';
    
    // 🔧 No notificar prioridades bajas
    if (prio === 'baja') {
        console.log(`ℹ️ [NOTIFICADOR] Prioridad "${prio}" para "${recurso.nombre}" - No se envía alerta`);
        return;
    }

    let contactos: any[] = [];
    try { 
        contactos = await getContactosParaPrioridad(prio); 
        console.log(`📧 [NOTIFICADOR] Prioridad "${prio}" para "${recurso.nombre}" - ${contactos.length} contacto(s) encontrado(s)`);
    } catch (e) { 
        contactos = []; 
        console.error(`❌ [NOTIFICADOR] Error obteniendo contactos para prioridad "${prio}":`, e);
    }

    if (contactos.length === 0) {
        console.warn(`⚠️ [NOTIFICADOR] No hay contactos designados para prioridad "${prio}". Alerta para "${recurso.nombre}" NO enviada.`);
        return;
    }

    for (const c of contactos) {
        // 🔧 Validar que el contacto realmente debe recibir esta prioridad
        const prioMin = c.prioridad_minima || 'baja';
        const niveles = { 'baja': 1, 'media': 2, 'alta': 3 };
        const nivelRecurso = niveles[prio as keyof typeof niveles] || 1;
        const nivelContacto = niveles[prioMin as keyof typeof niveles] || 1;
        
        if (nivelRecurso < nivelContacto) {
            console.log(`ℹ️ [NOTIFICADOR] Contacto "${c.nombre}" configurado para "${prioMin}+" - No recibe "${prio}"`);
            continue;
        }

        if (c.canal_correo && c.correo) {
            console.log(`📧 Enviando correo a ${c.correo} por "${recurso.nombre}" (prioridad: ${prio})`);
            await enviarAlertaMonitoreo(recurso, detalle, [c.correo]).catch(() => {});
            await registrarAviso(recurso, 'correo', c.correo, detalle, prio);
        }
        if (c.canal_sms && c.telefono && prio === 'alta') {
            console.log(`📱 Enviando SMS a ${c.telefono} por "${recurso.nombre}" (prioridad: ${prio})`);
            await enviarSMS(`ALERTA: ${recurso.nombre} (${recurso.ip}) - ${detalle}`).catch(() => {});
            await registrarAviso(recurso, 'sms', c.telefono, detalle, prio);
        }
    }
}