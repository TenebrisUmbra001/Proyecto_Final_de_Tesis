// ---------- Posiciones de cada municipio (porcentajes) ----------
var POSICIONES = {
  "img-sandino":      { left: "2.5390616761376923%",  top: "49.97333333333333%",  width: "31.98198198198198%" },
  "img-mantua":       { left: "17.122395391552097%",  top: "26.5564453125%",      width: "17.56756756756757%" },
  "img-minas":        { left: "28.51061742161301%",   top: "19.40622395833333%",  width: "13.813813813813812%" },
  "img-vinales":      { left: "38.426483169940184%",  top: "15.882666015624999%", width: "15.015015015015015%" },
  "img-palma":        { left: "48.127001913767664%",  top: "9.816888020833334%",  width: "14.264264264264265%" },
  "img-guane":        { left: "25.16025626330215%",   top: "33.14844401041667%",  width: "14.114114114114114%" },
  "img-sanluis":      { left: "43.92277897038016%",   top: "38.63111328125%",     width: "16.516516516516518%" },
  "img-sanjuan":      { left: "35.043570996928985%",  top: "32.9564453125%",      width: "14.264264264264265%" },
  "img-pinar":        { left: "44.68149110652818%",   top: "28.07466796875%",     width: "17.86786786786787%" },
  "img-consolacion":  { left: "51.44732003752341%",   top: "21.596445312500002%", width: "17.71771771771772%" },
  "img-los-palacios": { left: "58.02033710554333%",   top: "17.393779296875%",    width: "19.06906906906907%" }
};

var STORAGE_KEY = 'rim_topologia';

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

// ---------- Crea/lee la estructura en localStorage ----------
function cargarTopologia() {
  var raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return JSON.parse(raw);

  var data = { municipios: {} };
  var imgs = document.querySelectorAll('.municipio');
  for (var i = 0; i < imgs.length; i++) {
    var id = imgs[i].getAttribute('data-id');
    data.municipios[id] = {
      nombre: imgs[i].getAttribute('data-nombre'),
      unidades: [],
      conexiones: []
    };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
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

// ---------- UNA sola función para todos los municipios ----------
function seleccionarMunicipio(img) {
    var id = img.getAttribute('data-id');
    var nombre = img.getAttribute('data-nombre');

    document.getElementById('listad').textContent = 'Municipio seleccionado : ' + nombre;

    var data = cargarTopologia();
    var c = contarEquiposRed(data.municipios[id]);
    var total = c['switch'] + c['modem'] + c['transceiver'];

    document.getElementById('detalle').innerHTML =
        '<p><strong>Switches:</strong> ' + c['switch'] + '</p>' +
        '<p><strong>Modems:</strong> ' + c['modem'] + '</p>' +
        '<p><strong>Transceivers:</strong> ' + c['transceiver'] + '</p>' +
        '<p><strong>Total equipos de red:</strong> ' + total + '</p>' +
        '<button id="btnEntrar">Entrar a la información del municipio »</button>';

    document.getElementById('btnEntrar').addEventListener('click', function () {
        localStorage.setItem('rim_municipio_actual', id);
        window.location.href = '/private/topologia.html';
    });
}

// ---------- Inicio ----------
function iniciar() {
  aplicarPosiciones();
  cargarTopologia();

  // Un solo listener para los 11 municipios
  var imgs = document.querySelectorAll('.municipio');
  for (var i = 0; i < imgs.length; i++) {
    imgs[i].addEventListener('click', function () {
      seleccionarMunicipio(this);
    });
  }

  // Sesión: mostrar panel admin solo si corresponde + botón salir
  fetch('/api/sesion')
    .then(function (res) { return res.json(); })
    .then(function (sesion) {
      if (sesion.rol === 'admin' || sesion.rol === 'superadmin') {
        document.getElementById('btnAdmin').style.display = 'inline-block';
      }
    });

  document.getElementById('btnAdmin').addEventListener('click', function () {
    window.location.href = '/private/admin.html';
  });

  document.getElementById('btnSalir').addEventListener('click', function () {
    fetch('/api/logout', { method: 'POST' }).then(function () {
      window.location.href = '/';
    });
  });
}

document.addEventListener('DOMContentLoaded', iniciar);