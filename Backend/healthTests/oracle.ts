import { puertoTcp } from './pruebas';

// Por ahora: salud del listener (1521).
// Cuando instales node-oracledb + Instant Client, activa las métricas de tablespace.
export async function oracleCheck(ip: string, puerto = 1521): Promise<{ ok: boolean; detalle: string; metricas?: any }> {
    const ok = await puertoTcp(ip, puerto);
    if (!ok) return { ok: false, detalle: 'Listener Oracle (1521) caído' };
    return { ok: true, detalle: 'Listener Oracle OK' };

    // === FASE 2 (con node-oracledb) ===
    // const conn = await oracledb.getConnection({ user, password, connectString: ip + ':1521/' + sid });
    // const res = await conn.execute(
    //   "SELECT tablespace_name, used_percent FROM dba_tablespace_usage_metrics ORDER BY used_percent DESC"
    // );
    // → alerta temprana si used_percent > 85 (antes de que la BD se caiga por espacio)
}