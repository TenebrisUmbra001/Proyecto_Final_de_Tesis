// ---------- Posiciones de cada municipio (porcentajes) ----------
var POSICIONES = {
  "img-sandino": { left: "2.5390616761376923%", top: "49.97333333333333%", width: "31.98198198198198%" },
  "img-mantua": { left: "17.122395391552097%", top: "26.5564453125%", width: "17.56756756756757%" },
  "img-minas": { left: "28.51061742161301%", top: "19.40622395833333%", width: "13.813813813813812%" },
  "img-vinales": { left: "38.426483169940184%", top: "15.882666015624999%", width: "15.015015015015015%" },
  "img-palma": { left: "48.127001913767664%", top: "9.816888020833334%", width: "14.264264264264265%" },
  "img-guane": { left: "25.16025626330215%", top: "33.14844401041667%", width: "14.114114114114114%" },
  "img-sanluis": { left: "43.92277897038016%", top: "38.63111328125%", width: "16.516516516516518%" },
  "img-sanjuan": { left: "35.043570996928985%", top: "32.9564453125%", width: "14.264264264264265%" },
  "img-pinar": { left: "44.68149110652818%", top: "28.07466796875%", width: "17.86786786786787%" },
  "img-consolacion": { left: "51.44732003752341%", top: "21.596445312500002%", width: "17.71771771771772%" },
  "img-los-palacios": { left: "58.02033710554333%", top: "17.393779296875%", width: "19.06906906906907%" }
};

var conexionesGlobalesCache = [];
var rolUsuarioMapa = 'operador';

// ---------- Aplica las posiciones del JSON ----------
function aplicarPosiciones() {
  for (var id in POSICIONES) {
    var el = document.getElementById(id);
    if (el) {
      el.style.left = POSICIONES[id].left;
      el.style.top = POSICIONES[id].top;
      el.style.width = POSICIONES[id].width;
    }
  }
}

// ---------- Contador de SOLO equipos de red ----------
function contarEquiposRed(muni) {
  var c = { 'switch': 0, 'modem': 0, 'transceiver': 0 };
  var u, e, l, k;
  for (u = 0; u < muni.unidades.length; u++) {
    var edif = muni.unidades[u].edificios || [];
    for (e = 0; e < edif.length; e++) {
      var locs = edif[e].locales || [];
      for (l = 0; l < locs.length; l++) {
        var eqs = locs[l].equipos || [];
        for (k = 0; k < eqs.length; k++) {
          if (c.hasOwnProperty(eqs[k].tipo)) c[eqs[k].tipo]++;
        }
      }
    }
  }
  return c;
}

// ---------- Carga un municipio desde la BD ----------
function cargarMunicipio(id, callback) {
  fetch('/api/topologia/db/' + encodeURIComponent(id), { credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 404) { callback({ unidades: [], conexiones: [] }); return; }
      if (!r.ok) throw new Error('Error al cargar municipio');
      return r.json();
    })
    .then(function (data) { if (data) callback(data); })
    .catch(function (err) {
      console.error('Error cargando municipio ' + id + ':', err);
      callback({ unidades: [], conexiones: [] });
    });
}

// ---------- Selección de municipio ----------
function seleccionarMunicipio(img) {
  var id = img.getAttribute('data-id');
  var nombre = img.getAttribute('data-nombre');

  document.getElementById('listad').textContent = 'Municipio seleccionado : ' + nombre;
  document.getElementById('detalle').innerHTML = '<p style="color:#9fb3c8;">Cargando información...</p>';

  cargarMunicipio(id, function (muni) {
    var c = contarEquiposRed(muni);
    var total = c['switch'] + c['modem'] + c['transceiver'];

    document.getElementById('detalle').innerHTML =
      '<p><strong>Switches:</strong> ' + c['switch'] + '</p>' +
      '<p><strong>Modems:</strong> ' + c['modem'] + '</p>' +
      '<p><strong>Transceivers:</strong> ' + c['transceiver'] + '</p>' +
      '<p><strong>Total equipos de red:</strong> ' + total + '</p>' +
      '<button id="btnEntrar">Entrar a la información del municipio »</button>';

    document.getElementById('btnEntrar').addEventListener('click', function () {
      window.location.href = '/private/topologia.html?municipio=' + encodeURIComponent(id) + '&nombre=' + encodeURIComponent(nombre);
    });
  });
}

// ================= CONEXIONES GLOBALES =================

function cargarConexionesGlobales() {
  fetch('/api/topologia/conexiones-globales', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (lista) {
      conexionesGlobalesCache = lista || [];
      dibujarConexionesGlobales();
    })
    .catch(function (e) {
      console.error('Error cargando conexiones globales:', e);
    });
}

function centroMunicipio(imgId) {
  var el = document.getElementById(imgId);
  if (!el) return null;
  var contenedor = document.querySelector('.Mapa') || document.body;
  var contRect = contenedor.getBoundingClientRect();
  var elRect = el.getBoundingClientRect();
  return {
    x: elRect.left - contRect.left + elRect.width / 2,
    y: elRect.top - contRect.top + elRect.height / 2
  };
}

function imgIdPorMunicipioId(munId) {
  var imgs = document.querySelectorAll('.municipio');
  for (var i = 0; i < imgs.length; i++) {
    var id = imgs[i].getAttribute('data-id');
    if (id === munId) return imgs[i].id;
    if (id && munId && id.replace(/[^a-z0-9]/gi, '') === munId.replace(/[^a-z0-9]/gi, '')) return imgs[i].id;
  }
  return null;
}

function dibujarConexionesGlobales() {
  var svg = document.getElementById('capa-conexiones-mapa');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  for (var i = 0; i < conexionesGlobalesCache.length; i++) {
    var con = conexionesGlobalesCache[i];
    var imgA = imgIdPorMunicipioId(con.desde_municipio_id);
    var imgB = imgIdPorMunicipioId(con.hasta_municipio_id);
    if (!imgA || !imgB) continue;

    var pA = centroMunicipio(imgA);
    var pB = centroMunicipio(imgB);
    if (!pA || !pB) continue;

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', pA.x);
    line.setAttribute('y1', pA.y);
    line.setAttribute('x2', pB.x);
    line.setAttribute('y2', pB.y);
    line.setAttribute('stroke', con.tipo === 'FO' ? '#ff9f1c' : '#70e000');
    line.setAttribute('stroke-width', '4');
    line.setAttribute('stroke-dasharray', '8 6');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('pointer-events', 'stroke');
    line.style.cursor = 'pointer';

    var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = con.desde_municipio_nombre + ' ↔ ' + con.hasta_municipio_nombre +
      ' — ' + (con.tipo || '?') + ' ' + (con.velocidad || '');
    line.appendChild(title);

    line.setAttribute('data-con-id', con.id);
    line.addEventListener('click', (function (conexion) {
      return function (e) {
        e.stopPropagation();
        if (rolUsuarioMapa === 'admin' || rolUsuarioMapa === 'superadmin') {
          if (confirm('¿Eliminar conexión entre ' + conexion.desde_municipio_nombre + ' y ' + conexion.hasta_municipio_nombre + '?')) {
            eliminarConexionGlobalUI(conexion.id);
          }
        }
      };
    })(con));

    svg.appendChild(line);
  }
}

function eliminarConexionGlobalUI(id) {
  fetch('/api/topologia/conexiones-globales/' + encodeURIComponent(id), {
    method: 'DELETE', credentials: 'same-origin'
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.error) { alert('Error: ' + d.error); return; }
      cargarConexionesGlobales();
    })
    .catch(function () { alert('Error al eliminar'); });
}

function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

function abrirModalMapa(t, c) {
  var modal = document.getElementById('modal-mapa');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-mapa';
    modal.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:9999;justify-content:center;align-items:center;';
    modal.innerHTML = '<div style="background:#16283c;color:#e8eef5;border-radius:12px;width:560px;max-width:92%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.7);">' +
      '<div id="modal-mapa-titulo" style="background:#0f3460;color:#fff;padding:14px 18px;border-radius:12px 12px 0 0;font-weight:bold;"></div>' +
      '<div id="modal-mapa-cuerpo" style="padding:20px;overflow-y:auto;flex:1;"></div></div>';
    document.body.appendChild(modal);
  }
  document.getElementById('modal-mapa-titulo').textContent = t;
  var cu = document.getElementById('modal-mapa-cuerpo');
  cu.innerHTML = c;
  modal.style.display = 'flex';
}

function cerrarModalMapa() { var m = document.getElementById('modal-mapa'); if (m) m.style.display = 'none'; }

function abrirModalConexionGlobal() {
  fetch('/api/admin/equipos', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (equipos) {
      var html = '<p id="msgErrorGlobal" style="color:red;font-size:12px;"></p>';
      html += '<label>Equipo ORIGEN *</label>';
      html += '<select id="gDesde" style="width:100%;">';
      for (var i = 0; i < equipos.length; i++) {
        var e = equipos[i];
        html += '<option value="' + e.id + '" data-mun="' + esc(e.municipio) + '" data-munid="' + esc(e.municipioId || '') + '">' +
          esc(e.municipio) + ' — ' + esc(e.nombre) + ' (' + esc(e.ip || 'sin IP') + ')</option>';
      }
      html += '</select>';

      html += '<label>Equipo DESTINO *</label>';
      html += '<select id="gHasta" style="width:100%;">';
      for (var j = 0; j < equipos.length; j++) {
        var f = equipos[j];
        html += '<option value="' + f.id + '" data-mun="' + esc(f.municipio) + '" data-munid="' + esc(f.municipioId || '') + '">' +
          esc(f.municipio) + ' — ' + esc(f.nombre) + ' (' + esc(f.ip || 'sin IP') + ')</option>';
      }
      html += '</select>';

      html += '<label>Medio</label><select id="gTipo" style="width:100%;">' +
        '<option value="FO">Fibra óptica (FO)</option>' +
        '<option value="Ethernet">Ethernet</option></select>';

      html += '<label>Velocidad</label><select id="gVel" style="width:100%;">' +
        '<option value="1 Gbps">1 Gbps</option>' +
        '<option value="10 Gbps">10 Gbps</option>' +
        '<option value="40 Gbps">40 Gbps</option>' +
        '<option value="100 Gbps">100 Gbps</option></select>';

      html += '<label>Puerto en ORIGEN (opcional)</label><input type="number" id="gPuertoA" min="1" style="width:100%;">';
      html += '<label>Puerto en DESTINO (opcional)</label><input type="number" id="gPuertoB" min="1" style="width:100%;">';

      html += '<div style="text-align:center;margin-top:18px;">' +
        '<button class="btn b-verde" id="btnCrearGlobal">🔗 Crear conexión</button> ' +
        '<button class="btn b-gris" id="btnCancelGlobal">Cancelar</button></div>';

      abrirModalMapa('🔗 Conectar equipos entre municipios', html);

      document.getElementById('btnCancelGlobal').onclick = cerrarModalMapa;
      document.getElementById('btnCrearGlobal').onclick = function () {
        var err = document.getElementById('msgErrorGlobal');
        var selDesde = document.getElementById('gDesde');
        var selHasta = document.getElementById('gHasta');
        var desdeId = selDesde.value;
        var hastaId = selHasta.value;
        var munDesde = selDesde.options[selDesde.selectedIndex].getAttribute('data-mun');
        var munHasta = selHasta.options[selHasta.selectedIndex].getAttribute('data-mun');
        var munIdDesde = selDesde.options[selDesde.selectedIndex].getAttribute('data-munid');
        var munIdHasta = selHasta.options[selHasta.selectedIndex].getAttribute('data-munid');

        if (desdeId === hastaId) { err.textContent = 'No puedes conectar un equipo consigo mismo.'; return; }
        if (munDesde === munHasta) { err.textContent = 'Los dos equipos están en el mismo municipio. Usa el editor de topología.'; return; }

        var body = {
          id: 'cg-' + Date.now(),
          desde_id: desdeId,
          hasta_id: hastaId,
          desde_municipio_id: munIdDesde,
          hasta_municipio_id: munIdHasta,
          tipo: val('gTipo'),
          velocidad: val('gVel'),
          puerto_desde: val('gPuertoA') ? parseInt(val('gPuertoA'), 10) : null,
          puerto_hasta: val('gPuertoB') ? parseInt(val('gPuertoB'), 10) : null
        };

        fetch('/api/topologia/conexion-global', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body)
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.error) { err.textContent = 'Error: ' + d.error; return; }
            cerrarModalMapa();
            cargarConexionesGlobales();
            alert('Conexión global creada correctamente');
          })
          .catch(function () { err.textContent = 'Error al crear conexión'; });
      };
    })
    .catch(function () { alert('Error cargando equipos'); });
}

// ---------- Inicio ----------
function iniciar() {
  aplicarPosiciones();

  // 🔧 Crear capa SVG dentro de .Mapa (no de body)
  var contenedor = document.querySelector('.Mapa');
  if (contenedor) {
    if (contenedor.style.position === '' || contenedor.style.position === 'static') {
      contenedor.style.position = 'relative';
    }
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'capa-conexiones-mapa';
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '5';
    contenedor.appendChild(svg);
  }

  var imgs = document.querySelectorAll('.municipio');
  for (var i = 0; i < imgs.length; i++) {
    imgs[i].addEventListener('click', function () { seleccionarMunicipio(this); });
  }

  fetch('/api/sesion')
    .then(function (res) { return res.json(); })
    .then(function (sesion) {
      rolUsuarioMapa = sesion.rol || 'operador';
      if (sesion.rol === 'admin' || sesion.rol === 'superadmin') {
        document.getElementById('btnAdmin').style.display = 'inline-block';
        var btnGlobal = document.getElementById('btnConectarGlobal');
        if (btnGlobal) btnGlobal.style.display = 'inline-block';
      }
    });

  document.getElementById('btnAdmin').addEventListener('click', function () {
    window.location.href = '/private/admin.html';
  });

  var btnGlobal = document.getElementById('btnConectarGlobal');
  if (btnGlobal) {
    btnGlobal.addEventListener('click', abrirModalConexionGlobal);
  }

  document.getElementById('btnSalir').addEventListener('click', function () {
    fetch('/api/logout', { method: 'POST' }).then(function () { window.location.href = '/'; });
  });

  cargarConexionesGlobales();
  window.addEventListener('resize', function () { dibujarConexionesGlobales(); });
}

document.addEventListener('DOMContentLoaded', iniciar);