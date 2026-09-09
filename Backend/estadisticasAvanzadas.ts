import { extraerRecursos } from './healthTests/monitor';
import { obtenerEventosRango } from './historialBD';

export interface Incidente { inicio: number; fin: number | null; }

function extraerIncidentes(eventos: any[]): Incidente[] {
    const inc: Incidente[] = [];
    let abierto: Incidente | null = null;
    for (const ev of eventos) {
        if (!ev.ok) { if (!abierto) { abierto = { inicio: ev.t, fin: null }; inc.push(abierto); } }
        else { if (abierto) { abierto.fin = ev.t; abierto = null; } }
    }
    return inc;
}

function clavePeriodo(t: number, gran: string): string {
    const d = new Date(t);
    if (gran === 'dia') return d.toISOString().slice(0, 10);
    if (gran === 'semana') { const day = (d.getDay() + 6) % 7; const l = new Date(d); l.setDate(d.getDate() - day); return l.toISOString().slice(0, 10); }
    return d.toISOString().slice(0, 7);
}

export async function calcularTodo(desde: number, hasta: number, gran: string) {
    const eventos = await obtenerEventosRango(desde, hasta);
    const recursos = extraerRecursos() as any[];
    const munDeEquipo: Record<string, string> = {};
    const nombreDeEquipo: Record<string, string> = {};
    for (const r of recursos) { munDeEquipo[r.id] = r.municipio; nombreDeEquipo[r.id] = r.nombre; }

 
    // Agrupar eventos por equipo (nombre/municipio vienen de la BD)
    interface EquipoHistorial {
        nombre: string;
        municipio: string;
        eventos: any[];
        incidentes?: Incidente[];
    }
    const porEquipo: Record<string, EquipoHistorial> = {};
    for (const ev of eventos) {
        const id = ev.equipo_id;
        if (!porEquipo[id]) porEquipo[id] = { nombre: nombreDeEquipo[id] || ev.nombre || id, municipio: munDeEquipo[id] || ev.municipio || 'otros', eventos: [] };
        if (ev.nombre) porEquipo[id].nombre = ev.nombre;
        if (ev.municipio) porEquipo[id].municipio = ev.municipio;
        porEquipo[id].eventos.push(ev);
    }

    // ── 1. Tendencia ──
    const buckets: Record<string, { ok: number; total: number; porMun: Record<string, { ok: number; total: number }> }> = {};
    for (const id of Object.keys(porEquipo)) {
        const mun = porEquipo[id].municipio;
        for (const ev of porEquipo[id].eventos) {
            const k = clavePeriodo(ev.t, gran);
            buckets[k] = buckets[k] || { ok: 0, total: 0, porMun: {} };
            buckets[k].total++; if (ev.ok) buckets[k].ok++;
            buckets[k].porMun[mun] = buckets[k].porMun[mun] || { ok: 0, total: 0 };
            buckets[k].porMun[mun].total++; if (ev.ok) buckets[k].porMun[mun].ok++;
        }
    }
    const labels = Object.keys(buckets).sort();
    const global = labels.map(k => buckets[k].total ? Math.round(100 * buckets[k].ok / buckets[k].total) : 100);
    const munSet: Record<string, boolean> = {};
    for (const k of labels) for (const m of Object.keys(buckets[k].porMun)) munSet[m] = true;
    const porMunicipio: Record<string, number[]> = {};
    for (const m of Object.keys(munSet)) {
        porMunicipio[m] = labels.map(k => { const b = buckets[k].porMun[m]; return b && b.total ? Math.round(100 * b.ok / b.total) : (b ? 100 : null as any); });
    }

    // ── 2/3. Incidentes, Top, MTTR/MTBF ──
    for (const id of Object.keys(porEquipo)) (porEquipo as any)[id].incidentes = extraerIncidentes(porEquipo[id].eventos);

    const top = Object.keys(porEquipo)
        .map(id => ({ id, nombre: porEquipo[id].nombre, municipio: porEquipo[id].municipio, caidas: (porEquipo[id].incidentes || []).length }))
        .filter(x => x.caidas > 0).sort((a, b) => b.caidas - a.caidas).slice(0, 10);

    function mttrMtbfDe(incs: Incidente[]) {
        const cerrados = incs.filter(i => i.fin !== null);
        const mttrMin = cerrados.length ? Math.round(cerrados.reduce((s, i) => s + ((i.fin as number) - i.inicio), 0) / cerrados.length / 60000) : 0;
        let mtbfH = 0;
        if (incs.length >= 2) {
            const ord = incs.slice().sort((a, b) => a.inicio - b.inicio);
            const diffs: number[] = [];
            for (let i = 1; i < ord.length; i++) diffs.push(ord[i].inicio - ord[i - 1].inicio);
            mtbfH = Math.round(diffs.reduce((s, d) => s + d, 0) / diffs.length / 3600000);
        }
        return { mttrMin, mtbfH, incidentes: incs.length };
    }

    const todosIncs: Incidente[] = [];
    for (const id of Object.keys(porEquipo)) todosIncs.push(...(porEquipo[id].incidentes || []));
    const globalMM = mttrMtbfDe(todosIncs);

    const munSet2: Record<string, boolean> = {};
    for (const id of Object.keys(porEquipo)) munSet2[porEquipo[id].municipio] = true;
    const porMunicipioMM = Object.keys(munSet2).map(m => {
        const incs: Incidente[] = [];
        for (const id of Object.keys(porEquipo)) {
            if (porEquipo[id].municipio === m) {
                incs.push(...(porEquipo[id].incidentes || []));
            }
        }
        return { municipio: m, ...mttrMtbfDe(incs) };
    }).sort((a, b) => b.incidentes - a.incidentes);

    const porEquipoMM = Object.keys(porEquipo).map(id => ({ id, nombre: porEquipo[id].nombre, municipio: porEquipo[id].municipio, ...mttrMtbfDe(porEquipo[id].incidentes || []) }))
        .filter(x => x.incidentes > 0).sort((a, b) => b.incidentes - a.incidentes);

    // ── 4. Heatmap ──
    const heatmap: number[][] = [];
    for (let d = 0; d < 7; d++) heatmap.push(new Array(24).fill(0));
    for (const inc of todosIncs) { const dt = new Date(inc.inicio); heatmap[(dt.getDay() + 6) % 7][dt.getHours()]++; }

    return { tendencia: { labels, global, porMunicipio }, top, mttrMtbf: { global: globalMM, porMunicipio: porMunicipioMM, porEquipo: porEquipoMM }, heatmap };
}