/**
 * Stub para envío de SMS. 
 * TODO: Integrar módem GSM (gammu) o pasarela SMS interna del ministerio.
 */
export async function enviarSMS(texto: string): Promise<boolean> {
    const numeros = (process.env.ALERTAS_SMS || '').split(',').filter(Boolean);
    console.log('[SMS pendiente de gateway] →', numeros, ':', texto);
    return true;
}

export default { enviarSMS };