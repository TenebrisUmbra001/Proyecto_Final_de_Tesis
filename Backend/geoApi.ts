import {
    leerCapa, guardarObjeto, borrarObjeto, guardarEnlace, borrarEnlace,
    migrarCapa, estadisticasGeo
} from './db/geo';

type Req = any; type Res = any;

function usuarioDe(req: Req): string | null {
    const u = req.session && req.session.usuario;
    if (!u) return null;
    return u.nombre || u.usuario || null;
}

export function montarRutasGeo(app: any, requiereLogin: any, requiereRol: any) {
    const edita = requiereRol('admin', 'superadmin');

    // Lectura de la capa completa — todos los roles
    app.get('/api/geo/capa', requiereLogin, async (_req: Req, res: Res) => {
        try { res.json(await leerCapa()); }
        catch (e: any) { console.error('[GEO] capa:', e.message); res.status(500).json({ error: e.message }); }
    });

    // Diagnóstico
    app.get('/api/geo/estado', requiereLogin, async (_req: Req, res: Res) => {
        try { res.json(await estadisticasGeo()); }
        catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // Guardar estado de un objeto (lock + posición)
    app.put('/api/geo/objeto/:id', edita, async (req: Req, res: Res) => {
        try {
            const id = String(req.params.id || '').slice(0, 80);
            if (!id) return res.status(400).json({ error: 'id requerido' });
            await guardarObjeto(id, {
                locked: !!req.body.locked,
                lat: req.body.lat === undefined ? null : req.body.lat,
                lon: req.body.lon === undefined ? null : req.body.lon
            }, usuarioDe(req));
            res.json({ exito: true });
        } catch (e: any) { console.error('[GEO] objeto:', e.message); res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/geo/objeto/:id', edita, async (req: Req, res: Res) => {
        try { await borrarObjeto(String(req.params.id)); res.json({ exito: true }); }
        catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // Guardar estado de un enlace (lock + curvas)
    app.put('/api/geo/enlace/:id', edita, async (req: Req, res: Res) => {
        try {
            const id = String(req.params.id || '').slice(0, 80);
            if (!id) return res.status(400).json({ error: 'id requerido' });
            await guardarEnlace(id, {
                locked: !!req.body.locked,
                puntos: Array.isArray(req.body.puntos) ? req.body.puntos : []
            }, usuarioDe(req));
            res.json({ exito: true });
        } catch (e: any) { console.error('[GEO] enlace:', e.message); res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/geo/enlace/:id', edita, async (req: Req, res: Res) => {
        try { await borrarEnlace(String(req.params.id)); res.json({ exito: true }); }
        catch (e: any) { res.status(500).json({ error: e.message }); }
    });

    // Migración única desde localStorage
    app.post('/api/geo/migrar', edita, async (req: Req, res: Res) => {
        try {
            const capa = {
                locks: req.body.locks || {},
                pos: req.body.pos || {},
                curvas: req.body.curvas || {}
            };
            const r = await migrarCapa(capa, usuarioDe(req));
            console.log(`✅ [GEO] Migración: ${r.objetos} objeto(s), ${r.enlaces} enlace(s)`);
            res.json({ exito: true, ...r });
        } catch (e: any) { console.error('[GEO] migrar:', e.message); res.status(500).json({ error: e.message }); }
    });
}