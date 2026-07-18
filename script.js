var map = L.map("map").setView([51.2, 10.4], 7);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors, &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map);

var sel = {};
var selHol = {};
var geoL = null;
var allLayers = {};
var centroids = {};
var labelGroup = L.layerGroup().addTo(map);
var multiMode = false;
var multiPoints = [];
var multiCircles = L.layerGroup().addTo(map);

var GEO_URL =
  "https://gist.githubusercontent.com/fegoa89/edcd647f95ac4d21e48cacafcc722314/raw/plz-3stellig.geojson";
var SEL_COLOR = "#e4d4ec";
var plzDB = null;
fetch('https://raw.githubusercontent.com/Miselmasel/PLZ-Datenbank/main/webtools/plz-umkreissuche/data/plz_umkreisdaten.json')
  .then(function(r){return r.json();})
  .then(function(d){plzDB=d;})
  .catch(function(e){console.error('PLZ-DB Ladefehler:',e);});

var preisklassenMode = false;
var PREISKLASSEN = {
  '01':'r','02':'g','03':'g','04':'g',
  '06':'g','07':'g','08':'y','09':'r',
  '10':'l','12':'l','13':'l','14':'l','15':'l','16':'r','17':'l','18':'l','19':'y',
  '21':'l','22':'l','23':'l','24':'y','25':'y','26':'g','27':'y','28':'r','29':'y',
  '30':'r','31':'r','32':'g','33':'g','34':'y','35':'g','36':'g','37':'y','38':'g','39':'g',
  '40':'r','41':'l','42':'y','44':'l','45':'l','46':'y','47':'y','48':'g','49':'g',
  '50':'r','51':'r','52':'r','53':'l','54':'g','55':'g','56':'l','57':'l','58':'g','59':'g',
  '60':'r','61':'r','63':'r','64':'g','65':'y','66':'g','67':'g','68':'g','69':'y',
  '70':'r','71':'r','72':'y','73':'y','74':'y','75':'r','76':'r','77':'g','78':'g','79':'g',
  '80':'r','81':'r','82':'r','83':'y','84':'g','85':'y','86':'y','87':'y','88':'g','89':'g',
  '90':'l','91':'l','92':'g','93':'g','94':'g','95':'g','96':'y','97':'y','98':'y','99':'y'
};
var PK_FILL   = { 'r':'#e74c3c','y':'#f39c12','g':'#2ecc71','l':'#642d7b' };
var PK_BORDER = { 'r':'#c0392b','y':'#e67e22','g':'#27ae60','l':'#4a1f5c' };

// Liefert einen Mittelpunkt pro einzelner Teilflaeche - bei MultiPolygon-PLZ
// (z.B. getrennte Exklaven wie Leer bei 267) bekommt so jede Teilflaeche
// ihr eigenes Beschriftungslabel statt nur die groesste Teilflaeche.
function calcCentroids(geometry) {
  var rings = [];
  if (geometry.type === "Polygon") {
    rings = [geometry.coordinates[0]];
  } else if (geometry.type === "MultiPolygon") {
    rings = geometry.coordinates.map(function (poly) {
      return poly[0];
    });
  }
  return rings.map(ringCentroid);
}

function ringCentroid(ring) {
  var n = ring.length,
    cx = 0,
    cy = 0,
    area = 0;
  for (var i = 0; i < n - 1; i++) {
    var x0 = ring[i][0],
      y0 = ring[i][1];
    var x1 = ring[i + 1][0],
      y1 = ring[i + 1][1];
    var cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area = area / 2;
  cx = cx / (6 * area);
  cy = cy / (6 * area);
  return L.latLng(cy, cx);
}

function styleFeature(feature) {
  var plz3 = feature.properties.plz;
  if (selHol[plz3]) {
    return { fillColor: "#e74c3c", fillOpacity: 0.55, color: "#c0392b", weight: 1.5 };
  }
  if (preisklassenMode) {
    var pk = PREISKLASSEN[plz3.substring(0, 2)];
    if (pk) {
      return sel[plz3]
        ? { fillColor: PK_FILL[pk], fillOpacity: 0.85, color: PK_BORDER[pk], weight: 2.5 }
        : { fillColor: PK_FILL[pk], fillOpacity: 0.35, color: PK_BORDER[pk], weight: 0.7 };
    }
  }
  if (sel[plz3]) {
    return { fillColor: SEL_COLOR, fillOpacity: 0.5, color: "#642d7b", weight: 1.5 };
  }
  return { fillColor: "#aaa", fillOpacity: 0.08, color: "#999", weight: 0.5 };
}

function onEachFeature(feature, layer) {
  var plz3 = feature.properties.plz;
  allLayers[plz3] = layer;
  try {
    centroids[plz3] = calcCentroids(feature.geometry);
  } catch (e) {
    centroids[plz3] = [layer.getBounds().getCenter()];
  }
  layer.on("click", function () {
    togglePLZ(plz3);
  });
}

function addLabels() {
  labelGroup.clearLayers();
  var zoom = map.getZoom();
  if (zoom < 7) return;
  var fontSize = zoom < 8 ? 7 : zoom < 9 ? 9 : zoom < 10 ? 11 : 13;
  // Je weiter man rauszoomt, desto groesser der Mindestabstand zwischen Labels
  // (weniger PLZ-Beschriftungen) - je naeher man reinzoomt, desto kleiner der
  // Abstand (mehr Beschriftungen), bis ab Zoom 11 alle sichtbaren angezeigt werden.
  var spacing = zoom < 8 ? 80 : zoom < 9 ? 55 : zoom < 10 ? 35 : zoom < 11 ? 18 : 0;
  var bounds = map.getBounds();
  var occupied = [];
  function tooClose(pt) {
    for (var i = 0; i < occupied.length; i++) {
      var dx = occupied[i][0] - pt.x,
        dy = occupied[i][1] - pt.y;
      if (Math.sqrt(dx * dx + dy * dy) < spacing) return true;
    }
    return false;
  }
  Object.keys(centroids).forEach(function (plz3) {
    centroids[plz3].forEach(function (c) {
      if (!bounds.contains(c)) return;
      if (spacing > 0) {
        var pt = map.latLngToContainerPoint(c);
        if (tooClose(pt)) return;
        occupied.push([pt.x, pt.y]);
      }
      var icon = L.divIcon({
        className: "",
        html:
          '<div style="font-size:' +
          fontSize +
          'px;font-weight:bold;color:#666;text-shadow:1px 1px 0 #fff,-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff;white-space:nowrap;pointer-events:none;transform:translate(-50%,-50%);">' +
          plz3 +
          "xx</div>",
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });
      L.marker(c, { icon: icon, interactive: false, keyboard: false }).addTo(
        labelGroup
      );
    });
  });
}

map.on("zoomend moveend", addLabels);

function togglePLZ(plz3) {
  if (multiMode) {
    addMultiPoint(plz3);
    return;
  }
  if (sel[plz3]) {
    delete sel[plz3];
    delete selHol[plz3];
  } else {
    sel[plz3] = true;
  }
  refreshLayer(plz3);
  updateSidebar();

  // PLZ ins Suchfeld setzen
  var si = document.getElementById("si");
  if (si) si.value = plz3;
}

function refreshLayer(plz3) {
  var layer = allLayers[plz3];
  if (layer) layer.setStyle(styleFeature(layer.feature));
}

function refreshAll() {
  if (geoL)
    geoL.setStyle(function (f) {
      return styleFeature(f);
    });
}

function togglePreisklassen() {
  preisklassenMode = document.getElementById("pkToggle").checked;
  refreshAll();
}

function updateSidebar() {
  var keys = Object.keys(sel).sort();
  var acEl = document.getElementById("ac");
  if (acEl) acEl.querySelector("span:nth-child(2)").textContent = keys.length;
  var al = document.getElementById("al");
  if (al) {
    al.innerHTML = "";
    keys.forEach(function (p) {
      var d = document.createElement("div");
      d.style.cssText =
        "display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;margin:2px 0";
      var sp = document.createElement("span");
      sp.className = "ld";
      sp.style.background = SEL_COLOR;
      var tx = document.createElement("span");
      tx.textContent = p + "xx";
      d.appendChild(sp);
      d.appendChild(tx);
      d.onclick = function () {
        zenOn(p);
      };
      al.appendChild(d);
    });
  }
  var ta = document.getElementById("ta");
  if (ta)
    ta.textContent = keys
      .map(function (p) {
        return p + "xx";
      })
      .join(", ");
}

function zen() {
  var v = document.getElementById("si").value.trim();
  if (!v) return;
  var prefix = v.replace(/\D/g, "").substring(0, 3);
  zenOn(prefix);
}

function zenOn(prefix) {
  var layer = allLayers[prefix];
  if (layer) map.fitBounds(layer.getBounds());
}

function toggleMultiMode() {
  multiMode = !multiMode;
  var btn = document.getElementById("mpToggleBtn");
  if (btn) {
    btn.textContent = multiMode
      ? "Punkte setzen: AN (Karte anklicken)"
      : "Punkte per Klick setzen";
    btn.style.background = multiMode ? "#27ae60" : "";
  }
}

function addMultiPoint(plz3) {
  if (
    multiPoints.some(function (p) {
      return p.plz3 === plz3;
    })
  )
    return;
  if (multiPoints.length >= 5) {
    alert("Maximal 5 Punkte möglich.");
    return;
  }
  var layer = allLayers[plz3];
  if (!layer) return;
  var center = layer.getBounds().getCenter();
  multiPoints.push({ plz3: plz3, center: center });
  updateMultiList();
}

function removeMultiPoint(plz3) {
  multiPoints = multiPoints.filter(function (p) {
    return p.plz3 !== plz3;
  });
  updateMultiList();
}

function updateMultiList() {
  var countEl = document.getElementById("mpCount");
  if (countEl) countEl.textContent = multiPoints.length;
  var listEl = document.getElementById("mpList");
  if (listEl) {
    listEl.innerHTML = "";
    multiPoints.forEach(function (p) {
      var d = document.createElement("div");
      d.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;margin:2px 0";
      var tx = document.createElement("span");
      tx.textContent = p.plz3 + "xx";
      var rm = document.createElement("span");
      rm.textContent = "✕";
      rm.style.cssText = "color:#e74c3c;cursor:pointer;margin-left:6px;";
      rm.onclick = function () {
        removeMultiPoint(p.plz3);
      };
      d.appendChild(tx);
      d.appendChild(rm);
      listEl.appendChild(d);
    });
  }
}

// Nutzt die per Klick gesetzten Punkte, falls vorhanden - sonst die aktuell
// ausgewaehlten Gebiete (Mittelpunkt) als Ausgangspunkte.
function multiUmkreisPunkte() {
  if (multiPoints.length > 0) return multiPoints;
  return Object.keys(sel).map(function (p) {
    return { plz3: p, center: allLayers[p].getBounds().getCenter() };
  });
}

function multiUmkreis() {
  var points = multiUmkreisPunkte();
  var countEl = document.getElementById("mpCount");
  if (countEl) {
    countEl.textContent = points.length;
    countEl.style.color = points.length > 5 ? "#e74c3c" : "";
  }
  if (points.length === 0) {
    alert(
      "Bitte zuerst Gebiete anklicken (Auswahl) oder Punkte per Klick setzen aktivieren."
    );
    return;
  }
  if (points.length > 5) {
    alert(
      "Maximal 5 Ausgangspunkte moeglich (aktuell " + points.length + " Gebiete ausgewaehlt). Bitte Auswahl verringern oder gezielt Punkte per Klick setzen."
    );
    return;
  }
  var km = parseInt(document.getElementById("mrs").value);
  multiCircles.clearLayers();
  points.forEach(function (p) {
    L.circle(p.center, {
      radius: km * 1000,
      color: "#642d7b",
      fillOpacity: 0.05
    }).addTo(multiCircles);

    var circlePoly = turf.circle([p.center.lng, p.center.lat], km, {
      units: "kilometers"
    });
    Object.keys(allLayers).forEach(function (q) {
      if (sel[q]) return;
      var layerGeoJSON = allLayers[q].toGeoJSON();
      if (turf.booleanIntersects(circlePoly, layerGeoJSON)) {
        sel[q] = true;
        refreshLayer(q);
      }
    });
  });
  updateSidebar();
}

function multiUmkreisLoeschen() {
  multiPoints = [];
  multiCircles.clearLayers();
  updateMultiList();
}

function auswahlLoeschen() {
  sel = {};
  selHol = {};
  refreshAll();
  updateSidebar();
}

function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
          Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
          Math.sin(dLon/2)*Math.sin(dLon/2);
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))*10)/10;
}

function exportCSV() {
  var year = new Date().getFullYear();
  var keys = Object.keys(sel).sort();
  var lines = ["﻿PLZ-Bereich;PLZ;Ort;Bundesland;Einwohner;Entfernung_km;Feiertage"];
  keys.forEach(function(prefix) {
    var refs = centroids[prefix] || [];
    var refLat = 0, refLon = 0;
    refs.forEach(function(c){refLat+=c.lat; refLon+=c.lng;});
    if (refs.length > 0) { refLat/=refs.length; refLon/=refs.length; }
    var state = PLZ3_STAAT ? PLZ3_STAAT[prefix] : undefined;
    var holStr = (typeof getHolidaysForState === 'function') ? getHolidaysForState(state, year) : '';
    if (plzDB) {
      var matches = plzDB.filter(function(e){return e.plz.substring(0,3)===prefix;});
      if (matches.length === 0) {
        lines.push(prefix+'xx;;;;;'+';'+holStr);
      } else {
        matches.forEach(function(e){
          var dist = refs.length > 0 ? String(haversine(refLat,refLon,e.lat,e.lon)).replace('.',',') : '';
          lines.push([prefix+'xx',e.plz,e.ort,e.bundesland,e.einwohner,dist,holStr].join(';'));
        });
      }
    } else {
      lines.push(prefix+'xx;(DB nicht geladen);;;;'+';'+holStr);
    }
  });
  dlFile("auswahl.csv", lines.join("\n"), "text/csv");
}

function exportJSON() {
  var keys = Object.keys(sel).sort();
  var out = keys.map(function (p) {
    return p + "xx";
  });
  dlFile("auswahl.json", JSON.stringify(out, null, 2), "application/json");
}

function dlFile(name, content, type) {
  var a = document.createElement("a");
  a.href = "data:" + type + ";charset=utf-8," + encodeURIComponent(content);
  a.download = name;
  a.click();
}

fetch(GEO_URL)
  .then(function (r) {
    return r.json();
  })
  .then(function (data) {
    geoL = L.geoJSON(data, {
      style: styleFeature,
      onEachFeature: onEachFeature
    }).addTo(map);
    updateSidebar();
    addLabels();
  })
  .catch(function (e) {
    console.error("GeoJSON Fehler:", e);
  });

// ===== Overlay: Staedte, zoomabhaengig gestaffelt =====
var STAEDTE = [[52.5167,13.3833,"Berlin",3782202],[53.55,10.0,"Hamburg",1910160],[48.1375,11.575,"M\u00fcnchen",1510378],[50.9422,6.9578,"K\u00f6ln",1087353],[50.1106,8.6822,"Frankfurt am Main",775790],[48.7775,9.18,"Stuttgart",633484],[51.2256,6.7767,"D\u00fcsseldorf",631217],[51.3406,12.3747,"Leipzig",619879],[51.5139,7.4653,"Dortmund",595471],[51.4508,7.0131,"Essen",586608],[53.0758,8.8072,"Bremen",577026],[51.0493,13.7381,"Dresden",566222],[52.3744,9.7386,"Hannover",548186],[49.4539,11.0775,"N\u00fcrnberg",529508],[51.4322,6.7611,"Duisburg",503707],[51.4833,7.2167,"Bochum",366385],[51.2667,7.1833,"Wuppertal",358938],[52.0167,8.5333,"Bielefeld",338410],[50.7353,7.1022,"Bonn",335789],[51.9625,7.6256,"M\u00fcnster",322904],[49.4878,8.4661,"Mannheim",316877],[49.0167,8.4,"Karlsruhe",309964],[48.3689,10.8978,"Augsburg",303150],[50.0825,8.24,"Wiesbaden",285522],[51.2,6.4333,"M\u00f6nchengladbach",268943],[51.5103,7.0942,"Gelsenkirchen",265885],[50.7762,6.0838,"Aachen",252769],[52.2692,10.5211,"Braunschweig",252066],[50.8324,12.9189,"Chemnitz",250681],[54.3233,10.1394,"Kiel",248873],[51.4828,11.9697,"Halle (Saale)",242172],[52.1316,11.64,"Magdeburg",240114],[47.995,7.85,"Freiburg im Breisgau",237244],[51.3333,6.5667,"Krefeld",228550],[49.9994,8.2736,"Mainz",222889],[53.8697,10.6864,"L\u00fcbeck",219044],[50.9781,11.0289,"Erfurt",215199],[51.4699,6.8514,"Oberhausen",211099],[54.0833,12.1333,"Rostock",210795],[51.3158,9.4979,"Kassel",204687],[51.3594,7.475,"Hagen",190490],[52.4,13.0667,"Potsdam",187119],[49.2333,7.0,"Saarbr\u00fccken",183509],[51.6814,7.8192,"Hamm",180761],[49.4811,8.4353,"Ludwigshafen am Rhein",176110],[53.1439,8.2139,"Oldenburg",174629],[51.4275,6.8825,"M\u00fclheim an der Ruhr",173255],[52.2789,8.0431,"Osnabr\u00fcck",166960],[51.0333,6.9833,"Leverkusen",166414],[49.8667,8.65,"Darmstadt",164792],[49.4122,8.71,"Heidelberg",162960],[51.1719,7.0847,"Solingen",161545],[49.0167,12.0833,"Regensburg",159465],[51.5426,7.219,"Herne",157896],[51.7167,8.7667,"Paderborn",155749],[51.2003,6.6939,"Neuss",155163],[48.7631,11.425,"Ingolstadt",142308],[50.1,8.7667,"Offenbach am Main",135490],[49.7944,9.9294,"W\u00fcrzburg",132215],[49.4783,10.9903,"F\u00fcrth",132032],[49.1404,9.218,"Heilbronn",130093],[48.3986,9.9911,"Ulm",129942],[48.8909,8.703,"Pforzheim",128992],[52.4231,10.7872,"Wolfsburg",127256],[51.5339,9.9356,"G\u00f6ttingen",120261],[51.5232,6.9253,"Bottrop",118705],[48.4833,9.2167,"Reutlingen",118528],[49.5925,11.005,"Erlangen",117806],[50.3597,7.5978,"Koblenz",115298],[53.55,8.5833,"Bremerhaven",114677],[51.1799,7.1944,"Remscheid",112970],[49.7557,6.6394,"Trier",112737],[50.9917,7.1367,"Bergisch Gladbach",112660],[51.6167,7.2,"Recklinghausen",111693],[50.9272,11.5864,"Jena",109353],[51.4592,6.6197,"Moers",105606],[52.1503,10.3593,"Salzgitter",105039],[50.1328,8.9169,"Hanau",103184],[51.9,8.3833,"G\u00fctersloh",102464],[52.15,9.95,"Hildesheim",102325],[50.8756,8.0167,"Siegen",102114],[49.4447,7.7689,"Kaiserslautern",101486],[51.7608,14.3319,"Cottbus",100010],[54.7819,9.4367,"Flensburg",99307],[53.6289,11.415,"Schwerin",98733],[48.7406,9.3108,"Esslingen am Neckar",95881],[51.4333,7.3333,"Witten",95724],[50.5833,8.6667,"Gie\u00dfen",94996],[48.8975,9.1919,"Ludwigsburg",94859],[50.8782,12.0824,"Gera",94847],[48.52,9.0556,"T\u00fcbingen",93615],[50.8032,6.4821,"D\u00fcren",93323],[51.3833,7.6667,"Iserlohn",92404],[48.0632,8.493,"Villingen-Schwenningen",89145],[50.7189,12.4961,"Zwickau",87593],[51.3,6.85,"Ratingen",87513],[51.6167,7.5167,"L\u00fcnen",87266],[47.6633,9.1753,"Konstanz",85770],[49.6303,8.3621,"Worms",85609],[51.6667,7.1167,"Marl",85001],[52.2883,8.9167,"Minden",83100],[53.7064,10.0103,"Norderstedt",82719],[51.34,7.0416,"Velbert",82462],[49.8917,10.8917,"Bamberg",80580],[54.0714,9.99,"Neum\u00fcnster",80185],[51.8333,12.2333,"Dessau-Ro\u00dflau",79686],[51.2556,6.3917,"Viersen",79250],[53.0506,8.6317,"Delmenhorst",78979],[50.8167,8.7667,"Marburg",78203],[53.2525,10.4144,"L\u00fcneburg",77511],[52.2833,7.4333,"Rheine",77209],[51.66,6.9642,"Dorsten",76842],[50.8161,7.1556,"Troisdorf",76503],[53.5286,8.1056,"Wilhelmshaven",76247],[51.5713,6.9827,"Gladbeck",75799],[48.5397,12.1508,"Landshut",75272],[49.9481,11.5783,"Bayreuth",74907],[51.9378,8.8833,"Detmold",74835],[51.55,7.3167,"Castrop-Rauxel",74370],[51.3967,8.0644,"Arnsberg",74206],[52.4141,12.5541,"Brandenburg an der Havel",73921],[49.9741,9.1494,"Aschaffenburg",72918],[51.6667,8.35,"Lippstadt",72804],[51.8333,6.6167,"Bocholt",72409],[51.2198,7.6273,"L\u00fcdenscheid",71463],[47.7333,10.3167,"Kempten",70713],[50.5528,9.6775,"Fulda",70366],[52.6256,10.0825,"Celle",70293],[51.5667,6.7333,"Dinslaken",67949],[49.995,8.4119,"R\u00fcsselsheim am Main",67656],[50.8719,6.6961,"Kerpen",67627],[52.1146,8.6734,"Herford",67265],[50.4286,7.4614,"Neuwied",66243],[50.9811,11.3294,"Weimar",65611],[48.7133,9.0028,"Sindelfingen",65504],[50.495,12.1383,"Plauen",65218],[47.8561,12.1289,"Rosenheim",65192],[51.0964,6.84,"Dormagen",65170],[51.0883,6.5875,"Grevenbroich",64588],[53.5569,13.2608,"Neubrandenburg",64390],[47.6542,9.4792,"Friedrichshafen",63441],[48.8,9.8,"Schw\u00e4bisch Gm\u00fcnd",62726],[51.6,7.1333,"Herten",62204],[48.4708,7.9408,"Offenburg",62195],[50.9541,6.6412,"Bergheim",62172],[48.3833,10.0,"Neu-Ulm",61780],[52.4183,9.5981,"Garbsen",61594],[51.6586,6.6178,"Wesel",61277],[50.8775,6.8761,"H\u00fcrth",61252],[50.6613,6.7873,"Euskirchen",60256],[51.5347,7.6889,"Unna",60223],[54.0833,13.3833,"Greifswald",60071],[51.1167,6.95,"Langenfeld",59908],[54.3092,13.0819,"Stralsund",59450],[48.7025,9.6528,"G\u00f6ppingen",59300],[52.3421,14.5517,"Frankfurt (Oder)",58818],[52.1031,9.36,"Hameln",57916],[51.2667,6.6667,"Meerbusch",57440],[48.7619,8.2408,"Baden-Baden",57420],[52.5233,7.3172,"Lingen",57075],[51.1528,14.9872,"G\u00f6rlitz",56694],[50.77,7.1867,"Sankt Augustin",56692],[50.7667,6.2333,"Stolberg",56584],[51.0,6.8,"Pulheim",56284],[50.8167,6.2833,"Eschweiler",56132],[50.2292,8.6105,"Bad Homburg vor der H\u00f6he",55995],[48.8303,9.3169,"Waiblingen",55917],[52.4394,9.74,"Langenhagen",55746],[51.1714,6.9394,"Hilden",55689],[52.4333,7.0667,"Nordhorn",55619],[50.05,10.2333,"Schweinfurt",55067],[50.5667,8.5,"Wetzlar",54629],[51.3992,7.1858,"Hattingen",54620],[52.0833,8.7467,"Bad Salzuflen",54585],[48.5748,13.461,"Passau",54401],[49.3536,8.1361,"Neustadt an der Weinstra\u00dfe",53920],[51.79,6.14,"Kleve",53458],[51.7633,7.8911,"Ahlen",53278],[50.9167,6.8167,"Frechen",53128],[52.1622,10.5369,"Wolfenb\u00fcttel",53034],[49.8469,7.8669,"Bad Kreuznach",52989],[52.2778,7.7167,"Ibbenb\u00fcren",52688],[51.4333,7.8,"Menden (Sauerland)",52177],[48.6833,9.0,"B\u00f6blingen",52093],[51.0333,7.5667,"Gummersbach",51845],[48.8572,8.2031,"Rastatt",51800],[47.7831,9.6114,"Ravensburg",51788],[52.3203,10.2336,"Peine",51521],[49.3166,8.4336,"Speyer",51203],[53.7547,9.6536,"Elmshorn",50728],[47.6156,7.6614,"L\u00f6rrach",50670],[53.3669,7.2061,"Emden",50659],[51.906,10.4292,"Goslar",50253],[51.2631,6.5492,"Willich",50212],[52.2125,7.0417,"Gronau",50151],[50.8167,6.7667,"Erftstadt",50018],[48.4028,11.7489,"Freising",49939],[48.6761,10.1544,"Heidenheim an der Brenz",49895],[51.8417,8.3,"Rheda-Wiedenbr\u00fcck",49849],[48.8014,9.0131,"Leonberg",49845],[48.8772,12.5758,"Straubing",49775],[52.2,8.8,"Bad Oeynhausen",49566],[47.7628,8.84,"Singen (Hohentwiel)",49518],[51.6167,7.6333,"Bergkamen",49475],[53.8667,8.7,"Cuxhaven",49443],[48.3392,7.8722,"Lahr/Schwarzwald",49420],[49.5333,8.35,"Frankenthal",49122],[50.7592,7.005,"Bornheim",49074],[53.6008,9.4764,"Stade",48708],[50.8744,6.1615,"Alsdorf",48518],[52.7544,13.2369,"Oranienburg",48492],[49.1994,8.1231,"Landau in der Pfalz",48341],[48.2603,11.4342,"Dachau",48337],[51.5711,8.1092,"Soest",48250],[50.7833,7.2833,"Hennef",48190],[51.8308,7.2783,"D\u00fclmen",47937],[52.2031,8.3361,"Melle",47387],[50.2028,8.5769,"Oberursel",47241],[49.3448,7.1799,"Neunkirchen",47097],[50.8667,6.1,"Herzogenrath",47071],[49.1333,8.6,"Bruchsal",47014],[50.3167,11.9167,"Hof",46963],[48.2119,9.0239,"Albstadt",46831],[50.0256,8.8841,"Rodgau",46683],[51.4458,7.5653,"Schwerte",46571],[47.88,10.6225,"Kaufbeuren",46386],[50.9489,10.7183,"Gotha",46300],[48.6667,9.2167,"Filderstadt",46295],[48.8086,9.2758,"Fellbach",46205],[47.9878,10.1811,"Memmingen",46178],[52.2,8.6,"B\u00fcnde",45891],[51.8671,12.6484,"Lutherstadt Wittenberg",45588],[50.8333,6.9,"Br\u00fchl",45515],[49.5561,8.6697,"Weinheim",45381],[52.5055,9.4636,"Neustadt am R\u00fcbenberge",45325],[52.3725,9.9769,"Lehrte",45097],[52.5583,13.0917,"Falkensee",45005],[48.4772,8.9344,"Rottenburg am Neckar",44791],[53.6591,9.8009,"Pinneberg",44756],[51.08,6.3156,"Erkelenz",44572],[52.6667,13.5831,"Bernau bei Berlin",44254],[51.2278,6.6273,"Kaarst",44208],[53.8925,11.465,"Wismar",44022],[52.4886,10.5464,"Gifhorn",43941],[48.9494,9.1361,"Bietigheim-Bissingen",43808],[51.2239,6.9147,"Erkrath",43801],[51.0631,6.0964,"Heinsberg",43620],[51.8439,6.8583,"Borken",43589],[51.1,6.9,"Monheim am Rhein",43524],[51.3167,6.2833,"Nettetal",43425],[53.4714,7.4836,"Aurich",43375],[49.6735,12.1661,"Weiden in der Oberpfalz",43188],[51.5917,7.6653,"Kamen",43001],[50.9747,10.3244,"Eisenach",42817],[49.4444,11.8483,"Amberg",42676],[49.1122,9.7375,"Schw\u00e4bisch Hall",42598],[52.3077,9.8133,"Laatzen",42560],[49.3167,7.3333,"Homburg",42498],[50.0189,8.6961,"Dreieich",42389],[49.3,10.5833,"Ansbach",42311],[48.6483,9.4511,"Kirchheim unter Teck",42178],[50.2585,10.9579,"Coburg",42139],[50.8014,7.2044,"Siegburg",42025],[48.1333,11.3667,"Germering",41822],[49.6811,8.6228,"Bensheim",41758],[52.8331,13.8331,"Eberswalde",41704],[52.4238,9.4359,"Wunstorf",41666],[50.6833,7.1833,"K\u00f6nigswinter",41642],[49.253,6.8567,"V\u00f6lklingen",41632],[51.0608,6.2197,"H\u00fcckelhoven",41594],[48.6267,9.3353,"N\u00fcrtingen",41447],[49.3292,11.0208,"Schwabach",41380],[53.3285,9.8621,"Buchholz in der Nordheide",41290],[53.4769,9.7011,"Buxtehude",41256],[49.2833,11.4667,"Neumarkt in der Oberpfalz",41255],[51.505,10.7911,"Nordhausen",41233],[50.9119,13.3428,"Freiberg",41045],[49.2,7.6,"Pirmasens",40941],[48.8,9.5333,"Schorndorf",40614],[52.0794,7.0134,"Ahaus",40580],[52.0277,8.9043,"Lemgo",40531],[48.6928,9.1428,"Leinfelden-Echterdingen",40526],[50.0876,8.4447,"Hofheim am Taunus",40412],[52.2,8.7,"L\u00f6hne",40162],[51.8958,11.0467,"Halberstadt",40069],[49.9893,8.6803,"Langen",40009],[48.7228,9.2631,"Ostfildern",39833],[48.9333,8.4,"Ettlingen",39763],[50.1439,8.8371,"Maintal",39698],[51.0167,13.65,"Freital",39477],[50.8167,7.0333,"Niederkassel",39424],[50.0558,8.6971,"Neu-Isenburg",39420],[50.9622,13.9403,"Pirna",39303],[51.25,6.9667,"Mettmann",39197],[51.2,11.9667,"Wei\u00dfenfels",39181],[50.6872,10.9142,"Ilmenau",39147],[52.2917,13.625,"K\u00f6nigs Wusterhausen",39096],[52.6,11.85,"Stendal",38946],[53.0667,7.4,"Papenburg",38841],[50.8247,6.1275,"W\u00fcrselen",38750],[51.5,6.5333,"Kamp-Lintfort",38731],[48.5711,7.8089,"Kehl",38721],[50.8207,6.9786,"Wesseling",38355],[52.0917,7.6083,"Greven",38321],[48.1778,11.2556,"F\u00fcrstenfeldbruck",38187],[48.9464,9.4306,"Backnang",38184],[51.1814,14.4239,"Bautzen",38039],[51.75,7.1833,"Haltern am See",38033],[51.6425,12.3076,"Bitterfeld-Wolfen",37850],[51.9539,7.9933,"Warendorf",37847],[47.985,8.8233,"Tuttlingen",37784],[51.7558,8.0408,"Beckum",37452],[52.8478,8.0439,"Cloppenburg",37280],[51.9458,7.1675,"Coesfeld",37259],[48.3001,11.9082,"Erding",37169],[50.6106,10.6931,"Suhl",36986],[49.25,8.8833,"Sinsheim",36978],[51.2167,10.45,"M\u00fchlhausen/Th\u00fcringen",36641],[52.1728,7.5344,"Emsdetten",36556],[50.3833,8.0667,"Limburg an der Lahn",36506],[53.3667,10.2167,"Winsen",36499],[49.9747,8.0564,"Ingelheim am Rhein",36390],[52.2401,8.9214,"Porta Westfalica",36300],[51.6,6.6833,"Voerde",36282],[49.1347,10.0706,"Crailsheim",36239],[52.6906,7.291,"Meppen",36137],[50.1781,8.7361,"Bad Vilbel",36021],[48.8353,12.9644,"Deggendorf",35757],[51.6839,6.1619,"Goch",35520],[52.1504,7.3366,"Steinfurt",35456],[49.9896,8.5661,"M\u00f6rfelden-Walldorf",35359],[51.9833,8.8,"Lage",35311],[50.0086,8.7756,"Dietzenbach",35268],[51.6539,7.3417,"Datteln",35200],[53.2308,7.4528,"Leer",35163],[49.2789,7.115,"St. Ingbert",35059],[48.2731,8.8506,"Balingen",35054],[52.3031,9.4606,"Barsinghausen",34955],[49.3167,6.75,"Saarlouis",34893],[51.3658,6.4194,"Kempen",34888],[52.3961,9.5981,"Seelze",34798],[51.3544,11.9928,"Merseburg",34721],[51.1392,7.2051,"Wermelskirchen",34673],[53.5833,9.7,"Wedel",34617],[49.2494,7.3608,"Zweibr\u00fccken",34613],[51.5197,6.3325,"Geldern",34604],[53.6747,10.2411,"Ahrensburg",34601],[49.538,8.5792,"Viernheim",34348],[48.0981,9.7886,"Biberach an der Ri\u00df",34331],[51.1833,6.5167,"Korschenbroich",34324],[48.8597,9.185,"Kornwestheim",34177],[52.7306,8.2886,"Vechta",34145],[52.9647,10.5658,"Uelzen",33991],[51.3833,7.7667,"Hemer",33916],[47.5611,7.7917,"Rheinfelden (Baden)",33849],[50.3667,8.75,"Bad Nauheim",33809],[51.1033,13.67,"Radebeul",33804],[53.0631,14.2831,"Schwedt/Oder",33635],[49.7197,11.0581,"Forchheim",33610],[50.9222,6.3583,"J\u00fclich",33359],[52.9222,12.8,"Neuruppin",33107],[49.5942,8.4671,"Lampertheim",33053],[48.5967,8.8708,"Herrenberg",32961],[53.013,9.033,"Achim",32961],[51.7667,8.5667,"Delbr\u00fcck",32874],[52.3667,14.0667,"F\u00fcrstenwalde",32763],[53.4375,10.3675,"Geesthacht",32763],[47.7369,8.9697,"Radolfzell am Bodensee",32575],[52.6411,9.2069,"Nienburg/Weser",32423],[51.1521,11.8098,"Naumburg",32336],[53.925,9.5164,"Itzehoe",32319],[51.835,6.2453,"Emmerich am Rhein",32157],[51.8,11.7333,"Bernburg",32106],[52.2031,8.0447,"Georgsmarienh\u00fctte",32022],[51.835,10.7853,"Wernigerode",31943],[51.6422,7.2508,"Oer-Erkenschwick",31918],[52.4089,7.9728,"Bramsche",31801],[53.6313,8.7508,"Geestland",31713],[50.985,12.4333,"Altenburg",31580],[51.4331,14.25,"Hoyerswerda",31404],[52.4438,10.0078,"Burgdorf",31302],[50.9617,7.9881,"Kreuztal",31251],[51.3265,7.3559,"Gevelsberg",31198],[50.3353,8.755,"Friedberg",31131],[51.5467,6.6006,"Rheinberg",31096],[47.5947,7.6108,"Weil am Rhein",31065],[48.2833,11.5667,"Unterschlei\u00dfheim",31009],[51.5528,7.9139,"Werl",30938],[50.8415,7.2166,"Lohmar",30894],[52.8592,9.5853,"Walsrode",30890],[48.7333,11.1833,"Neuburg an der Donau",30881],[50.1435,8.1606,"Taunusstein",30820],[50.8683,9.7067,"Bad Hersfeld",30770],[51.8167,9.8667,"Einbeck",30725],[53.2269,8.7947,"Osterholz-Scharmbeck",30717],[48.35,10.9833,"Friedberg",30670],[51.1955,7.0085,"Haan",30558],[54.3044,9.6644,"Rendsburg",30545],[51.3021,7.3425,"Ennepetal",30502],[51.8,8.4333,"Rietberg",30461],[50.4397,7.4017,"Andernach",30408],[52.0167,11.75,"Sch\u00f6nebeck",30402],[48.8039,8.3194,"Gaggenau",30190],[49.0364,8.7061,"Bretten",30136],[49.4422,6.6375,"Merzig",30070],[51.3503,8.2836,"Meschede",29988],[51.6627,7.6355,"Werne",29868],[51.8258,8.1436,"Oelde",29783],[48.0528,10.8689,"Landsberg am Lech",29739],[51.6236,7.3972,"Waltrop",29586],[53.7939,12.1764,"G\u00fcstrow",29582],[50.1257,8.83,"M\u00fchlheim am Main",29452],[52.2997,13.2667,"Ludwigsfelde",29441],[48.8764,9.3978,"Winnenden",29436],[48.9328,8.9564,"Vaihingen an der Enz",29387],[51.7067,10.0011,"Northeim",29337],[51.3208,6.4931,"T\u00f6nisvorst",29331],[48.6244,9.8306,"Geislingen an der Steige",29261],[52.2167,9.55,"Springe",29258],[48.6953,8.135,"B\u00fchl",29214],[50.9,7.1833,"R\u00f6srath",29206],[49.7019,7.3253,"Idar-Oberstein",29158],[51.3081,13.2939,"Riesa",29127],[50.6506,11.3542,"Saalfeld/Saale",29121],[50.138,8.4525,"Kelkheim",29106],[51.1636,13.4775,"Mei\u00dfen",29051],[48.1214,7.8492,"Emmendingen",29035],[50.6,6.65,"Mechernich",28900],[49.9775,8.8281,"R\u00f6dermark",28835],[51.7667,9.3667,"H\u00f6xter",28749],[50.0722,8.4864,"Hattersheim am Main",28720],[51.2904,7.2972,"Schwelm",28711],[53.5089,10.2483,"Reinbek",28579],[51.5833,6.25,"Kevelaer",28466],[52.9211,9.2306,"Verden (Aller)",28453],[50.9653,6.1194,"Geilenkirchen",28399],[48.2689,10.8908,"K\u00f6nigsbrunn",28377],[51.0492,12.135,"Zeitz",28345],[51.2589,9.4183,"Baunatal",28298],[51.2383,12.7288,"Grimma",28269],[50.8342,10.9464,"Arnstadt",28264],[49.8594,8.5525,"Griesheim",28210],[51.1167,7.0167,"Leichlingen",28202],[51.4417,6.5583,"Neukirchen-Vluyn",28110],[48.2,11.3167,"Olching",28052],[50.9,6.1833,"Baesweiler",28005],[52.6667,8.2386,"Lohne",27949],[52.4022,13.2706,"Teltow",27880],[51.3167,8.0,"Sundern",27783],[52.5808,13.8814,"Strausberg",27780],[50.5447,7.1133,"Bad Neuenahr-Ahrweiler",27647],[49.6415,8.645,"Heppenheim",27610],[47.6858,9.8342,"Wangen im Allg\u00e4u",27608],[50.4367,8.6622,"Butzbach",27528],[51.8833,8.6167,"Schlo\u00df Holte-Stukenbrock",27520],[48.2833,9.7236,"Ehingen",27504],[50.9328,7.2839,"Overath",27489],[51.3837,7.3907,"Wetter (Ruhr)",27450],[51.7319,6.5908,"Hamminkeln",27450],[51.1333,6.2667,"Wegberg",27305],[49.3481,8.6911,"Leimen",27286],[48.8111,9.3656,"Weinstadt",27245],[50.6256,6.9491,"Rheinbach",27238],[48.5298,11.5038,"Pfaffenhofen an der Ilm",27143],[52.6667,13.2831,"Hohen Neuendorf",27131],[49.2942,8.6983,"Wiesloch",27120],[52.3781,12.935,"Werder (Havel)",26970],[51.6833,7.4833,"Selm",26767],[48.95,8.8392,"M\u00fchlacker",26664],[48.6314,8.0739,"Achern",26664],[52.6378,13.2036,"Hennigsdorf",26623],[49.9214,8.4818,"Gro\u00df-Gerau",26614],[51.3265,6.971,"Heiligenhaus",26590],[48.8689,9.2764,"Remseck am Neckar",26589],[49.1917,9.2244,"Neckarsulm",26523],[51.75,11.4667,"Aschersleben",26416],[49.5103,11.2772,"Lauf an der Pegnitz",26413],[53.5,8.4667,"Nordenham",26410],[49.9669,7.895,"Bingen am Rhein",26339],[49.9,8.6,"Weiterstadt",26291],[49.45,10.95,"Zirndorf",26257],[52.3081,8.6231,"L\u00fcbbecke",26161],[47.5458,9.6839,"Lindau",26155],[51.9667,8.2331,"Harsewinkel",26126],[50.1081,11.4556,"Kulmbach",26052],[50.645,7.2269,"Bad Honnef",26025],[50.2569,8.6418,"Friedrichsdorf",25937],[54.5153,9.5697,"Schleswig",25904],[47.8667,11.4667,"Geretsried",25863],[50.2206,8.2692,"Idstein",25709],[48.445,8.6911,"Horb am Neckar",25695],[51.8831,8.5167,"Verl",25691],[52.2281,11.0106,"Helmstedt",25633],[52.186,9.0792,"Rinteln",25626],[51.3956,8.5678,"Brilon",25624],[49.2,9.5,"\u00d6hringen",25591],[48.1681,8.6247,"Rottweil",25548],[50.0715,8.8482,"Obertshausen",25531],[47.8078,9.6417,"Weingarten",25521],[49.4667,7.1667,"St. Wendel",25503],[49.2461,11.0911,"Roth",25405],[48.9611,10.1306,"Ellwangen",25372],[50.95,7.5333,"Wiehl",25356],[51.5264,12.3425,"Delitzsch",25341],[48.8264,9.0667,"Ditzingen",25318],[49.0647,8.4717,"Stutensee",25311],[51.7681,7.4444,"L\u00fcdinghausen",25306],[51.4667,11.3,"Sangerhausen",25300],[49.8056,8.6044,"Pfungstadt",25299],[52.3772,8.6328,"Espelkamp",25294],[51.6708,8.6047,"Salzkotten",25283],[51.1236,8.0681,"Lennestadt",25275],[52.3833,8.9667,"Petershagen",25226],[53.5967,7.2056,"Norden",25210],[53.8117,10.3742,"Bad Oldesloe",25104],[50.6333,7.0167,"Meckenheim",25031],[47.6231,8.2144,"Waldshut-Tiengen",25019],[51.7511,11.9736,"K\u00f6then",24974],[51.1536,8.2853,"Schmallenberg",24970],[51.0294,7.8439,"Olpe",24961],[51.3614,7.244,"Sprockh\u00f6vel",24956],[52.9161,8.8186,"Syke",24956],[52.6,12.3333,"Rathenow",24918],[50.55,10.4167,"Meiningen",24867],[51.2128,7.8715,"Plettenberg",24788],[50.7169,11.3275,"Rudolstadt",24767],[49.4908,9.7731,"Bad Mergentheim",24752],[52.7917,7.2381,"Haren",24719],[50.8961,14.8072,"Zittau",24710],[49.57,10.8819,"Herzogenaurach",24674],[51.0,6.5625,"Bedburg",24645],[48.2167,12.4,"Waldkraiburg",24604],[52.3194,9.6556,"Ronnenberg",24505],[51.2756,12.3692,"Markkleeberg",24488],[51.45,8.3667,"Warstein",24464],[49.8358,8.4975,"Riedstadt",24464],[51.1264,7.9033,"Attendorn",24452],[48.7144,8.7375,"Calw",24448],[52.1465,14.63,"Eisenh\u00fcttenstadt",24447],[50.9197,6.1194,"\u00dcbach-Palenberg",24354],[48.4633,8.4111,"Freudenstadt",24337],[53.3969,8.1361,"Varel",24335],[52.3161,9.9642,"Sehnde",24167],[51.1011,6.5017,"J\u00fcchen",24141],[51.2719,8.8731,"Korbach",24089],[53.25,7.9167,"Westerstede",23984],[51.8515,11.5889,"Sta\u00dffurt",23963],[47.9972,11.3406,"Starnberg",23940],[50.8667,12.75,"Limbach-Oberfrohna",23923],[50.2027,9.1905,"Gelnhausen",23841],[54.4769,9.0511,"Husum",23814],[51.1194,13.1128,"D\u00f6beln",23728],[49.35,9.1333,"Mosbach",23647],[47.8256,10.0222,"Leutkirch im Allg\u00e4u",23588],[50.7333,8.2833,"Dillenburg",23533],[48.4167,10.8667,"Gersthofen",23492],[53.8397,9.9603,"Kaltenkirchen",23478],[50.35,11.1667,"Sonneberg",23435],[50.9147,8.1,"Netphen",23430],[51.4167,9.65,"Hann. M\u00fcnden",23418],[52.85,11.15,"Salzwedel",23394],[47.8333,11.1333,"Weilheim in Oberbayern",23378],[49.7333,10.1667,"Kitzingen",23377],[51.4881,9.14,"Warburg",23336],[48.5519,8.7256,"Nagold",23321],[49.75,9.5167,"Wertheim",23319],[51.5167,14.0167,"Senftenberg",23282],[51.7917,11.1472,"Quedlinburg",23277],[52.0331,6.8331,"Vreden",23265],[50.2322,8.7681,"Karben",23253],[48.4,10.8333,"Neus\u00e4\u00df",23251],[50.2,10.0667,"Bad Kissingen",23245],[47.7667,9.165,"\u00dcberlingen",23240],[53.0206,7.8586,"Friesoythe",23234],[50.1424,8.4997,"Bad Soden am Taunus",23174],[48.3236,10.0442,"Senden",23143],[50.8117,10.2333,"Bad Salzungen",23133],[52.1897,7.8525,"Lengerich",23067],[48.1114,11.7311,"Haar",23056],[48.2289,9.8797,"Laupheim",23044],[52.3247,9.2069,"Stadthagen",22924],[51.0247,11.5139,"Apolda",22896],[53.1114,9.4108,"Rotenburg",22789],[52.2725,11.855,"Burg",22738],[51.4,7.4333,"Herdecke",22665],[51.5167,11.55,"Eisleben",22609],[50.2908,9.1125,"B\u00fcdingen",22607],[49.2389,9.1028,"Bad Rappenau",22586],[50.1437,8.569,"Eschborn",22551],[48.5367,9.2858,"Metzingen",22530],[54.1961,9.0933,"Heide",22467],[53.7333,9.8972,"Quickborn",22339],[47.9531,8.5033,"Donaueschingen",22312],[48.0939,7.9608,"Waldkirch",22266],[49.1333,8.9167,"Eppingen",22252],[52.0436,8.15,"Versmold",22242],[48.45,11.1333,"Aichach",22222],[52.0608,8.3597,"Halle (Westf.)",22198],[51.2,7.35,"Radevormwald",22159],[52.9833,9.8333,"Soltau",22040],[47.5142,10.2817,"Sonthofen",22035],[50.9333,6.5667,"Elsdorf",21993],[47.9181,7.7025,"Bad Krozingen",21971],[52.5264,11.3925,"Gardelegen",21926],[48.6933,9.7067,"Eislingen/Fils",21894],[48.4525,10.2711,"G\u00fcnzburg",21865],[48.2456,12.5228,"M\u00fchldorf am Inn",21860],[50.8233,12.5444,"Glauchau",21807],[51.6622,6.4539,"Xanten",21776],[49.25,8.5169,"Wagh\u00e4usel",21766],[50.0441,8.9753,"Seligenstadt",21752],[50.0117,8.4281,"Fl\u00f6rsheim am Main",21751],[51.6397,8.5086,"Geseke",21749],[50.8333,9.0167,"Stadtallendorf",21733],[52.2167,13.4497,"Zossen",21643],[49.3181,8.5472,"Hockenheim",21631],[54.4742,9.8378,"Eckernf\u00f6rde",21620],[49.3833,8.5667,"Schwetzingen",21609],[47.8683,12.6433,"Traunstein",21551],[51.55,8.5667,"B\u00fcren",21524],[51.8828,10.5617,"Bad Harzburg",21503],[51.5717,14.3794,"Spremberg",21497],[51.9681,12.0844,"Zerbst/Anhalt",21483],[51.7625,6.3978,"Rees",21452],[52.8931,8.4314,"Wildeshausen",21424],[48.15,11.35,"Puchheim",21410],[51.7286,10.2522,"Osterode am Harz",21382],[50.7,6.65,"Z\u00fclpich",21375],[49.2167,8.3667,"Germersheim",21295],[48.2269,8.3842,"Schramberg",21231],[53.5167,12.6833,"Waren",21217],[51.3667,10.8667,"Sondershausen",21183],[50.6825,8.3061,"Herborn",21142],[51.1167,7.4,"Wipperf\u00fcrth",21059],[48.85,10.5,"N\u00f6rdlingen",21053],[52.2972,7.5861,"H\u00f6rstel",21049],[47.9667,12.5833,"Traunreut",21021],[49.8684,8.929,"Gro\u00df-Umstadt",21018],[51.2833,7.0333,"W\u00fclfrath",21009],[52.0831,13.1667,"Luckenwalde",21000],[48.4064,9.0575,"M\u00f6ssingen",20979],[53.5333,7.95,"Schortens",20932],[48.6333,12.5,"Dingolfing",20927],[50.1833,8.9167,"Bruchk\u00f6bel",20894],[53.5747,7.7808,"Wittmund",20835],[50.7333,12.3833,"Werdau",20793],[51.9925,6.915,"Stadtlohn",20791],[47.9211,9.7519,"Bad Waldsee",20786],[52.1333,8.5667,"Enger",20724],[48.9606,8.2897,"Rheinstetten",20695],[49.3861,8.3761,"Schifferstadt",20682],[51.1061,7.6403,"Meinerzhagen",20653],[50.25,8.9,"Nidderau",20652],[47.6708,9.5875,"Tettnang",20520],[52.5,9.8667,"Burgwedel",20481],[51.4719,7.7658,"Fr\u00f6ndenberg/Ruhr",20450],[50.1469,11.0683,"Lichtenfels",20403],[48.8306,9.1214,"Korntal-M\u00fcnchingen",20394],[52.2056,7.1903,"Ochtrup",20392],[53.3647,13.0636,"Neustrelitz",20385],[48.6217,10.245,"Giengen an der Brenz",20358],[51.5125,10.2597,"Duderstadt",20320],[51.9819,7.7856,"Telgte",20301],[50.6167,12.3,"Reichenbach im Vogtland",20273],[47.6494,7.8247,"Schopfheim",20238],[48.5322,8.0786,"Oberkirch",20237],[50.6547,12.1997,"Greiz",20220],[51.8297,9.4483,"Holzminden",20217],[49.2373,7.2529,"Blieskastel",20202],[53.9194,10.6975,"Bad Schwartau",20169],[48.7184,10.777,"Donauw\u00f6rth",20108],[50.8789,7.615,"Waldbr\u00f6l",20081],[48.5769,10.4939,"Dillingen an der Donau",20070],[51.3833,10.3333,"Leinefelde-Worbis",20053],[48.4667,11.9333,"Moosburg an der Isar",20027],[51.1167,12.5,"Borna",20013],[50.7167,10.45,"Schmalkalden",19984],[49.2333,9.2167,"Bad Friedrichshall",19964],[49.3574,6.7196,"Dillingen/Saar",19941],[52.2394,9.8606,"Sarstedt",19896],[52.0167,11.25,"Oschersleben (Bode)",19885],[50.3333,7.2167,"Mayen",19882],[51.8333,6.7006,"Rhede",19837],[53.6028,9.8233,"Schenefeld",19817],[51.8367,8.0256,"Ennigerloh",19812],[48.8,9.0653,"Gerlingen",19774],[47.8083,7.6308,"M\u00fcllheim im Markgr\u00e4flerland",19756],[52.2608,9.0492,"B\u00fcckeburg",19754],[47.8639,12.01,"Bad Aibling",19745],[49.9869,6.8897,"Wittlich",19718],[51.46,8.8556,"Marsberg",19704],[50.5965,12.685,"Aue-Bad Schlema",19698],[51.9867,9.2636,"Bad Pyrmont",19596],[50.7422,8.2039,"Haiger",19596],[53.6269,10.6847,"M\u00f6lln",19566],[52.6,12.8831,"Nauen",19563],[49.5,11.75,"Sulzbach-Rosenberg",19548],[51.1,6.15,"Wassenberg",19541],[49.7517,8.1161,"Alzey",19530],[47.9133,11.4278,"Wolfratshausen",19499],[51.7333,9.0167,"Bad Driburg",19496],[48.1667,12.8333,"Burghausen",19494],[48.96,9.0647,"Sachsenheim",19480],[48.3517,8.9633,"Hechingen",19475],[50.58,13.0022,"Annaberg-Buchholz",19470],[51.1881,10.0528,"Eschwege",19435],[50.0596,8.8068,"Heusenstamm",19426],[47.85,12.0667,"Kolbermoor",19414],[47.7603,11.5567,"Bad T\u00f6lz",19360],[48.7508,8.8706,"Weil der Stadt",19340],[51.4,12.2167,"Schkeuditz",19234],[48.4656,9.2261,"Pfullingen",19221],[52.2833,11.4167,"Haldensleben",19188],[51.8931,10.1783,"Seesen",19185],[53.1167,9.8,"Schneverdingen",19169],[49.41,6.91,"Lebach",19108],[47.7247,12.8769,"Bad Reichenhall",19087],[51.1617,11.1169,"S\u00f6mmerda",19052],[51.7953,10.9622,"Blankenburg",19034],[47.7667,10.6167,"Marktoberdorf",19033],[53.4833,9.1333,"Bremerv\u00f6rde",19023],[53.3098,13.8627,"Prenzlau",19022],[51.0856,7.1136,"Burscheid",19005],[51.3128,7.0869,"Neviges",18937],[49.0306,10.9719,"Wei\u00dfenburg in Bayern",18931],[53.9361,10.3097,"Bad Segeberg",18891],[52.3236,9.7256,"Hemmingen",18885],[51.0497,8.4,"Bad Berleburg",18833],[51.1167,13.9167,"Radeberg",18824],[49.4618,8.1724,"Bad D\u00fcrkheim",18821],[50.0108,8.3508,"Hochheim am Main",18810],[50.0835,9.0669,"Alzenau",18787],[53.6872,9.6692,"Uetersen",18776],[51.9886,9.8269,"Alfeld (Leine)",18679],[50.9128,9.1889,"Schwalmstadt",18661],[53.5406,10.2111,"Glinde",18656],[48.7661,8.9347,"Renningen",18655],[51.3588,9.4677,"Vellmar",18622],[51.0208,7.6481,"Bergneustadt",18621],[48.2228,10.1053,"Illertissen",18578],[50.1797,8.5085,"Kronberg im Taunus",18569],[52.1667,9.25,"Hessisch Oldendorf",18556],[49.7028,6.5794,"Konz",18539],[50.3011,7.6056,"Lahnstein",18536],[50.8181,12.3875,"Crimmitschau",18479],[49.0517,8.2603,"W\u00f6rth am Rhein",18405],[52.1667,8.8497,"Vlotho",18403],[53.6116,8.6032,"Langen",18395],[53.4277,11.8482,"Parchim",18270],[49.2833,6.8833,"P\u00fcttlingen",18243],[49.5217,9.3233,"Buchen",18203],[50.525,8.7333,"Pohlheim",18199],[48.5669,11.2583,"Schrobenhausen",18199],[51.0589,8.7967,"Frankenberg (Eder)",18138],[48.0869,9.2167,"Sigmaringen",18127],[51.2919,13.5342,"Gro\u00dfenhain",18077],[48.6331,13.1883,"Vilshofen an der Donau",18061],[47.8333,12.9667,"Freilassing",18036],[48.2667,10.8167,"Bobingen",18022],[49.4219,10.9583,"Oberasbach",17807],[50.4128,9.0092,"Nidda",17768],[51.2563,7.7562,"Werdohl",17762],[48.075,8.6385,"Trossingen",17744],[50.8975,7.8742,"Freudenberg",17738],[48.0158,9.501,"Bad Saulgau",17724],[51.7453,14.6478,"Forst (Lausitz)",17721],[52.5222,8.1956,"Damme",17686],[48.0058,10.5969,"Bad W\u00f6rishofen",17683],[49.3494,7.2594,"Bexbach",17663],[47.5533,7.9472,"Bad S\u00e4ckingen",17637],[51.1081,10.6467,"Bad Langensalza",17626],[52.6072,8.3711,"Diepholz",17608],[49.2183,12.6658,"Cham",17593],[49.9624,8.9533,"Babenhausen",17579],[48.25,11.65,"Garching bei M\u00fcnchen",17577],[50.5531,6.7661,"Bad M\u00fcnstereifel",17568],[50.5094,12.4,"Auerbach/Vogtl.",17562],[52.1992,9.4653,"Bad M\u00fcnder am Deister",17511],[51.1167,9.1167,"Bad Wildungen",17473],[51.9569,7.0056,"Gescher",17467],[49.9747,6.5256,"Bitburg",17465],[47.8514,9.0114,"Stockach",17402],[50.5453,7.2519,"Sinzig",17399],[50.5786,7.2306,"Remagen",17387],[53.5042,10.4792,"Schwarzenbek",17370],[50.0688,8.5301,"Kelsterbach",17365],[51.8833,8.9667,"Horn-Bad Meinberg",17329],[54.1378,10.6181,"Eutin",17296],[51.9667,8.6667,"Oerlinghausen",17287],[51.3775,10.1344,"Heilbad Heiligenstadt",17260],[50.0,12.0667,"Marktredwitz",17254],[49.1147,10.7542,"Gunzenhausen",17237],[50.4297,7.5703,"Bendorf",17208],[49.9646,8.3464,"Ginsheim-Gustavsburg",17143],[50.6667,9.7667,"H\u00fcnfeld",17130],[48.9167,11.8667,"Kelheim",17094],[50.025,8.1201,"Eltville am Rhein",17040],[52.9977,11.7504,"Wittenberge",16982],[50.2411,11.3281,"Kronach",16924],[47.75,11.3667,"Penzberg",16909],[51.7833,8.8167,"Bad Lippspringe",16884],[51.27,14.0953,"Kamenz",16861],[50.1831,8.4635,"K\u00f6nigstein im Taunus",16831],[49.0833,9.0667,"Brackenheim",16795],[52.8494,8.7267,"Bassum",16794],[49.8261,8.8348,"Reinheim",16729],[51.7511,11.0428,"Thale",16721],[51.3667,12.7333,"Wurzen",16715],[50.9833,13.8667,"Heidenau",16667],[48.4164,9.9189,"Blaustein",16606],[50.8167,8.9167,"Kirchhain",16578],[50.0097,8.45,"Raunheim",16564],[51.45,6.2667,"Straelen",16544],[48.3997,13.3167,"Pocking",16509],[51.6167,8.3497,"Erwitte",16484],[49.2804,9.6902,"K\u00fcnzelsau",16436],[50.6508,13.1647,"Marienberg",16420],[49.2833,7.0667,"Sulzbach/Saar",16368],[52.3031,7.1597,"Bad Bentheim",16321],[51.1333,7.5667,"Kierspe",16320],[53.7286,10.2608,"Bargteheide",16320],[51.3,7.6667,"Altena",16315],[51.7167,9.1833,"Brakel",16310],[51.1834,7.5027,"Halver",16284],[48.9347,9.1917,"Freiberg am Neckar",16227],[48.0531,10.4915,"Mindelheim",16226],[51.9504,14.7143,"Guben",16210],[50.7511,9.2711,"Alsfeld",16205],[51.4608,12.6358,"Eilenburg",16201],[54.2367,10.2822,"Preetz",16186],[50.1635,8.9808,"Erlensee",16162],[48.6747,9.3817,"Wendlingen am Neckar",16159],[51.3017,12.2211,"Markranst\u00e4dt",16145],[50.35,9.5167,"Schl\u00fcchtern",16126],[47.5667,10.7,"F\u00fcssen",16072],[50.5853,12.7008,"Aue",16012],[48.9406,9.2575,"Marbach am Neckar",16010],[48.0289,7.58,"Breisach am Rhein",16007],[49.3,8.65,"Walldorf",15995],[51.3778,9.0167,"Bad Arolsen",15984],[49.6786,9.0042,"Michelstadt",15975],[53.1692,7.3564,"Weener",15916],[50.6486,11.9806,"Zeulenroda-Triebes",15890],[51.7944,7.7392,"Drensteinfurt",15865],[51.6282,13.7102,"Finsterwalde",15864],[52.25,10.8167,"K\u00f6nigslutter am Elm",15860],[49.5394,6.89,"Wadern",15860],[52.4328,8.6133,"Rahden",15859],[48.4994,10.1211,"Langenau",15792],[51.8679,13.9688,"L\u00fcbbenau/Spreewald",15774],[48.7147,9.5236,"Ebersbach an der Fils",15768],[51.38,12.4936,"Taucha",15759],[54.1072,10.8158,"Neustadt in Holstein",15749],[49.3875,11.3569,"Altdorf bei N\u00fcrnberg",15746],[50.5453,12.7792,"Schwarzenberg/Erzgeb.",15740],[54.25,12.4667,"Ribnitz-Damgarten",15729],[49.8985,8.8385,"Dieburg",15723],[50.3219,10.2161,"Bad Neustadt an der Saale",15720],[51.496,9.3872,"Hofgeismar",15626],[48.3667,10.85,"Stadtbergen",15614],[53.1217,13.5083,"Templin",15604],[50.2314,7.5908,"Boppard",15593],[50.1542,8.5288,"Schwalbach am Taunus",15566],[49.4011,8.6297,"Eppelheim",15543],[48.65,11.7833,"Mainburg",15517],[53.9186,9.8844,"Bad Bramstedt",15451],[51.805,10.3356,"Clausthal-Zellerfeld",15436],[51.9331,9.0831,"Blomberg",15417],[52.9886,10.0911,"Munster",15413],[49.9936,9.5783,"Lohr am Main",15353],[52.3135,9.6008,"Gehrden",15329],[49.8333,8.75,"Ober-Ramstadt",15313],[49.4736,8.6592,"Schriesheim",15309],[51.9381,10.335,"Langelsheim",15302],[48.2667,12.15,"Dorfen",15197],[47.6919,10.0394,"Isny im Allg\u00e4u",15190],[53.3333,8.4833,"Brake",15102],[51.1333,9.2667,"Fritzlar",15101],[48.9047,9.0808,"Markgr\u00f6ningen",15099],[51.3417,9.8569,"Witzenhausen",15097],[50.334,8.5372,"Usingen",15095],[50.3289,11.1211,"Neustadt bei Coburg",15089],[51.5246,12.1596,"Landsberg",15088],[47.9094,9.8994,"Bad Wurzach",15069],[49.9603,9.7722,"Karlstadt am Main",15062],[51.5,14.6331,"Wei\u00dfwasser/O.L.",14992],[48.8,11.7667,"Neustadt an der Donau",14949],[48.1789,10.755,"Schwabm\u00fcnchen",14926],[53.5744,7.9008,"Jever",14913],[48.4128,9.4953,"M\u00fcnsingen",14860],[49.4167,11.0167,"Stein",14851],[51.145,7.3417,"H\u00fcckeswagen",14770],[48.7058,9.5919,"Uhingen",14753],[50.1667,12.1333,"Selb",14727],[50.9983,8.1094,"Hilchenbach",14714],[51.0339,9.4056,"Homberg (Efze)",14712],[48.8167,11.8501,"Abensberg",14685],[48.2914,8.5725,"Oberndorf am Neckar",14684],[52.2645,9.7644,"Pattensen",14678],[50.4375,7.8258,"Montabaur",14677],[49.1242,8.7147,"Kraichtal",14635],[50.1833,9.0333,"Langenselbold",14630],[47.5667,10.2167,"Immenstadt im Allg\u00e4u",14622],[48.9878,12.1964,"Neutraubling",14614],[51.0522,13.5383,"Wilsdruff",14613],[53.7,9.7167,"Tornesch",14606],[49.5686,9.7039,"Lauda-K\u00f6nigshofen",14596],[48.7117,9.4164,"Plochingen",14590],[51.9897,8.0408,"Sassenberg",14566],[53.7017,10.7567,"Ratzeburg",14552],[49.2061,12.0409,"Burglengenfeld",14527],[49.4014,7.1634,"Ottweiler",14522],[49.4667,8.9833,"Eberbach",14489],[51.35,8.4833,"Olsberg",14481],[48.4039,12.7642,"Eggenfelden",14439],[48.7633,8.3342,"Gernsbach",14438],[47.7208,9.3917,"Markdorf",14406],[48.6749,12.6913,"Landau an der Isar",14402],[51.6167,12.2333,"Sandersdorf-Brehna",14398],[52.1331,8.4831,"Spenge",14389],[51.0944,14.6667,"L\u00f6bau",14389],[53.2969,9.2789,"Zeven",14376],[50.3003,8.5072,"Neu-Anspach",14359],[48.05,11.9667,"Grafing bei M\u00fcnchen",14348],[50.5217,8.8208,"Lich",14310],[48.9794,9.5783,"Murrhardt",14248],[50.3,8.2667,"Bad Camberg",14229],[48.7767,12.8736,"Plattling",14227],[51.7389,6.2925,"Kalkar",14199],[50.9856,12.9811,"Mittweida",14198],[50.8933,13.6667,"Dippoldiswalde",14174],[51.3167,12.0167,"Leuna",14174],[49.5692,8.1681,"Gr\u00fcnstadt",14169],[51.6597,9.6358,"Uslar",14166],[48.2833,10.0833,"V\u00f6hringen",14134],[48.0375,10.725,"Buchloe",14119],[51.1333,9.55,"Melsungen",14107],[49.6569,8.9931,"Erbach",14099],[51.3003,13.1072,"Oschatz",14089],[48.3044,10.1593,"Wei\u00dfenhorn",14088],[49.6539,8.5675,"Lorsch",14088],[48.3281,9.8878,"Erbach",14080],[49.7056,10.8058,"H\u00f6chstadt an der Aisch",14063],[50.5833,8.4667,"A\u00dflar",14043],[54.287,10.2258,"Schwentinental",14032],[50.5942,12.6456,"Schneeberg",14028],[50.995,9.7272,"Rotenburg an der Fulda",14020],[53.1633,12.4856,"Wittstock/Dosse",13994],[48.2556,7.8119,"Ettenheim",13985],[50.0353,10.5123,"Ha\u00dffurt",13982],[51.95,13.9,"L\u00fcbben (Spreewald)",13967],[51.7917,12.9556,"Jessen (Elster)",13966],[50.2833,9.3667,"Bad Soden-Salm\u00fcnster",13960],[49.1833,11.1833,"Hilpoltstein",13953],[51.4693,13.7632,"Lauchhammer",13951],[52.6772,7.9575,"Quakenbr\u00fcck",13947],[50.6,8.95,"Gr\u00fcnberg",13940],[48.2431,10.3633,"Krumbach",13940],[50.8,12.7167,"Hohenstein-Ernstthal",13937],[50.5397,8.4072,"Solms",13921],[49.2369,8.4547,"Philippsburg",13910],[50.9711,9.7903,"Bebra",13908],[50.6378,9.3944,"Lauterbach",13883],[48.8919,11.1839,"Eichst\u00e4tt",13867],[50.9108,13.0378,"Frankenberg/Sa.",13862],[48.6392,9.0108,"Holzgerlingen",13841],[48.9064,9.1414,"Asperg",13836],[52.736,7.7579,"L\u00f6ningen",13823],[50.8519,12.4636,"Meerane",13797],[48.0758,8.7378,"Spaichingen",13795],[52.2333,12.9667,"Beelitz",13794],[48.0167,8.5333,"Bad D\u00fcrrheim",13793],[53.0333,14.0,"Angerm\u00fcnde",13775],[51.8439,7.8278,"Sendenhorst",13760],[49.7564,11.545,"Pegnitz",13741],[50.9128,8.5322,"Biedenkopf",13717],[48.4419,12.9443,"Pfarrkirchen",13694],[52.0667,11.4333,"Wanzleben-B\u00f6rde",13669],[52.6667,7.4667,"Hasel\u00fcnne",13663],[47.9242,9.2567,"Pfullendorf",13654],[54.4167,13.4333,"Bergen auf R\u00fcgen",13650],[52.4067,12.1592,"Genthin",13646],[50.1401,8.392,"Eppstein",13645],[50.5333,8.65,"Linden",13631],[49.3939,8.7975,"Neckargem\u00fcnd",13629],[49.6225,9.6628,"Tauberbischofsheim",13621],[53.4,7.7333,"Wiesmoor",13610],[50.895,12.3564,"Schm\u00f6lln",13607],[49.58,10.6089,"Neustadt an der Aisch",13523],[52.0578,10.0058,"Bad Salzdetfurth",13523],[52.8103,9.9611,"Bergen",13520],[50.9303,8.4167,"Bad Laasphe",13504],[51.645,11.5111,"Hettstedt",13498],[52.4333,10.9833,"Oebisfelde-Weferlingen",13479],[49.1519,9.2858,"Weinsberg",13468],[52.6622,8.125,"Dinklage",13468],[52.6667,8.8,"Sulingen",13430],[51.3272,9.1709,"Wolfhagen",13411],[50.4833,8.25,"Weilburg",13395],[52.3167,7.2167,"Sch\u00fcttorf",13387],[51.8939,6.9897,"Velen",13381],[49.2194,8.7108,"\u00d6stringen",13299],[51.7086,7.38,"Olfen",13298],[51.6628,9.3725,"Beverungen",13277],[52.9831,13.3331,"Zehdenick",13267],[50.5331,6.4667,"Schleiden",13233],[49.1936,12.5192,"Roding",13224],[54.4368,11.1975,"Fehmarn",13218],[48.1247,8.3308,"St. Georgen im Schwarzwald",13203],[50.2986,8.7006,"Rosbach vor der H\u00f6he",13199],[48.9553,10.9094,"Treuchtlingen",13181],[48.6253,10.1739,"Herbrechtingen",13179],[48.2267,12.6783,"Alt\u00f6tting",13172],[47.6331,7.9042,"Wehr",13113],[48.0608,12.2333,"Wasserburg am Inn",13112],[54.1069,11.9053,"Bad Doberan",13105],[50.45,8.05,"Hadamar",13093],[50.2667,9.3,"W\u00e4chtersbach",13061],[50.9789,6.2678,"Linnich",13056],[50.4731,8.8996,"Hungen",13033],[51.6917,12.0666,"S\u00fcdliches Anhalt",13004],[52.8,8.65,"Twistringen",12952],[50.2883,11.0276,"R\u00f6dental",12947],[48.9989,9.1414,"Besigheim",12923],[52.1405,11.9533,"M\u00f6ckern",12885],[49.1667,10.3167,"Feuchtwangen",12875],[51.2,9.7167,"Hessisch Lichtenau",12798],[51.195,8.53,"Winterberg",12792],[51.6556,10.3394,"Herzberg am Harz",12783],[49.5081,11.4328,"Hersbruck",12772],[47.8167,10.9,"Schongau",12769],[49.5,10.4167,"Bad Windsheim",12766],[48.3628,8.6317,"Sulz am Neckar",12760],[48.4932,9.3989,"Bad Urach",12755],[52.6882,13.1776,"Velten",12733],[48.9217,9.1206,"Tamm",12726],[49.4719,8.6092,"Ladenburg",12704],[51.9933,13.0728,"J\u00fcterbog",12661],[48.4119,9.785,"Blaubeuren",12657],[53.8964,9.1386,"Brunsb\u00fcttel",12651],[51.8658,9.0944,"Steinheim",12643],[48.4475,12.3475,"Vilsbiburg",12621],[50.7681,8.5828,"Gladenbach",12594],[49.4847,11.2475,"R\u00f6thenbach an der Pegnitz",12565],[51.0491,9.2793,"Borken",12565],[51.5167,8.7,"Bad W\u00fcnnenberg",12546],[48.0833,11.9667,"Ebersberg",12527],[47.8147,7.5619,"Neuenburg am Rhein",12520],[50.8975,10.5558,"Waltershausen",12512],[52.2833,8.5,"Preu\u00dfisch Oldendorf",12456],[48.4897,9.6861,"Laichingen",12447],[50.6597,10.6669,"Zella-Mehlis",12445],[48.6886,9.4222,"Wernau (Neckar)",12443],[53.3332,11.5023,"Ludwigslust",12420],[47.9122,8.2147,"Titisee-Neustadt",12395],[53.85,13.6833,"Anklam",12363],[49.0,9.7667,"Gaildorf",12361],[53.4317,11.1931,"Hagenow",12344],[52.7856,14.0325,"Bad Freienwalde",12296],[49.2,12.1,"Maxh\u00fctte-Haidhof",12278],[49.0708,10.3194,"Dinkelsb\u00fchl",12272],[48.2903,9.1094,"Burladingen",12263],[48.7,13.0167,"Osterhofen",12237],[51.0561,12.555,"Frohburg",12186],[52.8675,9.6967,"Bad Fallingbostel",12119],[47.789,11.8338,"Miesbach",12109],[54.05,13.7667,"Wolgast",12092],[48.9667,9.2833,"Steinheim an der Murr",12082],[53.0667,11.8667,"Perleberg",12026],[52.4167,13.75,"Erkner",12008],[53.3758,10.5589,"Lauenburg/Elbe",11999],[49.0625,8.8019,"Oberderdingen",11956],[51.025,14.2141,"Neustadt in Sachsen",11929],[50.55,6.25,"Monschau",11895],[49.5903,8.6564,"Hemsbach",11884],[49.0764,9.1567,"Lauffen am Neckar",11863],[50.7,11.6,"P\u00f6\u00dfneck",11858],[51.2839,7.78,"Neuenrade",11835],[51.2955,12.0658,"Bad D\u00fcrrenberg",11801],[51.9792,7.295,"Billerbeck",11790],[52.25,11.6167,"Wolmirstedt",11782],[49.9831,7.9656,"Geisenheim",11776],[48.6517,13.6236,"Hauzenberg",11775],[49.15,9.1167,"Leingarten",11772],[50.0085,8.0199,"Oestrich-Winkel",11769],[51.0237,7.7772,"Drolshagen",11766],[49.5831,9.3681,"Walld\u00fcrn",11760],[47.6031,9.8861,"Lindenberg im Allg\u00e4u",11741],[53.1497,12.1831,"Pritzwalk",11736],[48.684,11.6117,"Geisenfeld",11729],[49.1333,9.05,"Schwaigern",11726],[49.85,9.6,"Marktheidenfeld",11724],[50.6303,12.8133,"Zw\u00f6nitz",11702],[48.8569,10.3522,"Bopfingen",11696],[50.4261,10.7289,"Hildburghausen",11682],[52.3369,9.3786,"Bad Nenndorf",11629],[50.1401,8.0694,"Bad Schwalbach",11602],[51.8833,12.4333,"Coswig",11468],[48.028,12.5586,"Trostberg",11463],[48.5667,10.4333,"Lauingen",11445],[49.6711,10.0498,"Ochsenfurt",11434],[47.8528,8.7714,"Engen",11431],[51.0,14.6,"Ebersbach-Neugersdorf",11421],[52.7281,10.7391,"Wittingen",11388],[50.3708,8.0158,"Diez",11388],[49.3772,10.1789,"Rothenburg ob der Tauber",11385],[51.7292,12.4556,"Gr\u00e4fenhainichen",11380],[48.8747,9.6344,"Welzheim",11378],[48.6678,7.9347,"Rheinau",11365],[50.3869,7.4953,"M\u00fclheim-K\u00e4rlich",11321],[48.1553,9.4728,"Riedlingen",11271],[51.8331,6.4667,"Isselburg",11260],[48.2219,7.7775,"Herbolzheim",11242],[48.7306,13.6011,"Waldkirchen",11221],[52.1422,12.5956,"Bad Belzig",11216],[50.9681,11.9014,"Eisenberg",11196],[48.8097,8.945,"Rutesheim",11194],[52.075,8.4125,"Werther (Westf.)",11193],[50.5175,8.3889,"Braunfels",11167],[52.138,10.9674,"Sch\u00f6ningen",11167],[51.3333,7.8667,"Balve",11108],[48.1806,8.9625,"Me\u00dfstetten",11086],[48.1917,7.7683,"Kenzingen",11071],[51.4933,8.4333,"R\u00fcthen",11049],[48.3647,8.805,"Haigerloch",11044],[50.7083,12.7783,"Stollberg/Erzgeb.",11033],[48.7983,9.6883,"Lorch",11032],[48.6833,9.8167,"Donzdorf",11031],[48.97,13.1264,"Regen",11009],[49.7517,8.485,"Gernsheim",11006],[52.3167,13.6333,"Wildau",10994],[53.7917,9.4219,"Gl\u00fcckstadt",10987],[48.4042,8.0153,"Gengenbach",10984],[48.5864,8.6047,"Altensteig",10983],[51.6158,8.8947,"Lichtenau",10940],[49.4944,10.7947,"Langenzenn",10924],[50.7222,12.6986,"Oelsnitz/Erzgeb.",10883],[52.0833,9.7833,"Gronau (Leine)",10882],[53.3743,10.7231,"Boizenburg/Elbe",10881],[50.1678,8.5719,"Steinbach (Taunus)",10869],[50.7564,12.6317,"Lichtenstein/Sa.",10853],[50.1167,9.9,"Hammelburg",10826],[51.3156,10.3194,"Dingelst\u00e4dt",10789],[51.9667,10.7167,"Osterwieck",10768],[50.2167,9.35,"Bad Orb",10759],[52.1157,8.2034,"Dissen am Teutoburger Wald",10730],[48.1408,7.7064,"Endingen am Kaiserstuhl",10708],[53.7833,9.7667,"Barmstedt",10683],[51.1346,9.4215,"Felsberg",10658],[50.099,10.9962,"Bad Staffelstein",10651],[52.5,6.9667,"Neuenhaus",10650],[51.1275,14.1797,"Bischofswerda",10648],[48.4322,10.4069,"Burgau",10628],[48.7503,8.5506,"Bad Wildbad",10601],[52.85,7.6833,"Werlte",10588],[52.1592,8.0472,"Bad Iburg",10574],[48.2656,13.0231,"Simbach am Inn",10521],[52.4333,11.8,"Tangerh\u00fctte",10516],[50.6497,8.7044,"Lollar",10509],[54.3167,9.6833,"B\u00fcdelsdorf",10470],[52.0739,11.8231,"Gommern",10464],[50.5117,10.7506,"Schleusingen",10449],[50.8558,13.0714,"Fl\u00f6ha",10426],[47.9542,9.6389,"Aulendorf",10422],[51.2833,11.9,"Braunsbedra",10413],[50.9201,12.8055,"Burgst\u00e4dt",10402],[50.7856,7.8728,"Betzdorf",10401],[53.8645,11.1909,"Grevesm\u00fchlen",10398],[48.615,9.5386,"Weilheim an der Teck",10397],[50.7,6.4833,"Nideggen",10397],[49.9083,8.2028,"Nieder-Olm",10393],[50.3167,9.4667,"Steinau an der Stra\u00dfe",10381],[51.05,13.3,"Nossen",10377],[48.6239,8.7472,"Wildberg",10372],[48.6797,9.7575,"S\u00fc\u00dfen",10366],[49.2333,9.3333,"Neuenstadt am Kocher",10350],[49.8039,9.1639,"Erlenbach am Main",10335],[48.9167,12.6833,"Bogen",10333],[47.8392,8.5342,"Blumberg",10329],[50.6564,13.3452,"Olbernhau",10307],[53.905,13.0439,"Demmin",10293],[49.0342,11.4726,"Beilngries",10282],[51.6317,10.4706,"Bad Lauterberg im Harz",10258],[51.3833,11.6,"Querfurt",10253],[52.5408,11.9689,"Tangerm\u00fcnde",10228],[50.1831,11.7857,"M\u00fcnchberg",10200],[52.4508,9.2078,"Rehburg-Loccum",10188],[49.979,7.9234,"R\u00fcdesheim am Rhein",10180],[54.7881,8.8297,"Nieb\u00fcll",10159],[51.4401,10.5727,"Bleicherode",10151],[49.5667,8.9667,"Oberzent",10129],[48.7833,9.9333,"Heubach",10105],[52.2667,13.5333,"Mittenwalde",10084],[51.05,12.3,"Meuselwitz",10079],[48.0497,9.33,"Mengen",10077],[51.1762,9.3575,"Gudensberg",10059],[50.2993,8.8145,"Niddatal",10059],[50.5,9.1167,"Schotten",10053],[50.85,9.1167,"Neustadt",10051],[53.95,10.2167,"Wahlstedt",10050],[51.3558,11.1011,"Bad Frankenhausen/Kyffh\u00e4user",10042],[48.6228,9.2372,"Aichtal",10031],[50.0497,9.7056,"Gem\u00fcnden am Main",10012],[50.3381,7.7106,"Bad Ems",10002]];

var cityGroup = L.layerGroup().addTo(map);

function cityPopThreshold(zoom) {
  if (zoom <= 5) return 500000;
  if (zoom === 6) return 200000;
  if (zoom === 7) return 100000;
  if (zoom === 8) return 50000;
  if (zoom === 9) return 30000;
  if (zoom === 10) return 20000;
  if (zoom === 11) return 10000;
  return 0;
}

function isNRWArea(lat, lon) {
  return lat >= 50.3 && lat <= 52.1 && lon >= 5.9 && lon <= 9.2;
}

function cityPopThresholdNRW(zoom) {
  if (zoom <= 6) return 500000;
  if (zoom === 7) return 250000;
  if (zoom === 8) return 150000;
  if (zoom === 9) return 75000;
  if (zoom === 10) return 40000;
  return 0;
}

var cityMinPop = 50000;
var CITY_OPTIONS = [50000, 30000, 20000, 10000];

function closestCityOption(threshold) {
  for (var i = 0; i < CITY_OPTIONS.length; i++) {
    if (threshold >= CITY_OPTIONS[i]) return CITY_OPTIONS[i];
  }
  return CITY_OPTIONS[CITY_OPTIONS.length - 1];
}

function onCityMinPopChange() {
  cityMinPop = parseInt(document.getElementById("cityMinPop").value);
  updateCityLayer();
}

function updateCityLayer() {
  cityGroup.clearLayers();
  var zoom = map.getZoom();
  var naturalThreshold = cityPopThreshold(zoom);
  // Ab der hoechsten Zoomstufe gewinnt der Zoom immer - dann werden alle
  // Staedte bis 10.000 gezeigt, unabhaengig vom Dropdown-Filter. Bei allen
  // anderen Zoomstufen bleibt der Dropdown-Wert die Untergrenze.
  var threshold = zoom >= 11 ? naturalThreshold : Math.max(naturalThreshold, cityMinPop);
  // Wenn der Zoom die Untergrenze unter den Dropdown-Wert drueckt (nur bei
  // Zoomstufe 11), soll das Dropdown das auch anzeigen statt stumm falsch zu
  // bleiben. Beim Rauszoomen springt es automatisch zur eigentlichen Auswahl zurueck.
  var sel = document.getElementById("cityMinPop");
  if (sel) {
    var displayValue = threshold < cityMinPop ? closestCityOption(threshold) : cityMinPop;
    if (String(displayValue) !== sel.value) sel.value = String(displayValue);
  }
  STAEDTE.forEach(function (c) {
    var lat = c[0], lon = c[1], name = c[2], pop = c[3];
    var thr = threshold;
    if (isNRWArea(lat, lon)) {
      thr = Math.max(thr, cityPopThresholdNRW(zoom));
    }
    if (pop < thr) return;
    L.circleMarker([lat, lon], {
      radius: pop > 500000 ? 5 : pop > 100000 ? 4 : 3,
      color: "#2c3e50",
      fillColor: "#2c3e50",
      fillOpacity: 1,
      weight: 1
    }).addTo(cityGroup);

    var icon = L.divIcon({
      className: "",
      html:
        '<div style="font-size:' + (pop > 500000 ? 13 : pop > 100000 ? 11 : 10) +
        'px;font-weight:600;color:#2c3e50;text-shadow:1px 1px 0 #fff,-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff;white-space:nowrap;pointer-events:none;transform:translate(6px,-6px);">' +
        name + "</div>",
      iconSize: [0, 0],
      iconAnchor: [0, 0]
    });
    L.marker([lat, lon], { icon: icon, interactive: false, keyboard: false }).addTo(cityGroup);
  });
}

map.on("zoomend", updateCityLayer);
updateCityLayer();

// ===== Overlay: Bundeslaender, pastellfarben im Hintergrund =====
var BL_GEO_URL =
  "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/2_bundeslaender/4_niedrig.geo.json";
var blGroup = L.layerGroup();
var blVisible = false;

map.createPane("blPane");
map.getPane("blPane").style.zIndex = 350;
map.getPane("blPane").style.pointerEvents = "none";

function blColor(i) {
  return "hsl(" + Math.round((i * 360) / 16) + ",55%,82%)";
}

fetch(BL_GEO_URL)
  .then(function (r) {
    return r.json();
  })
  .then(function (data) {
    data.features.forEach(function (f, i) {
      L.geoJSON(f, {
        pane: "blPane",
        interactive: false,
        style: {
          fillColor: blColor(i),
          fillOpacity: 0.45,
          color: "#888",
          weight: 1
        }
      }).addTo(blGroup);
    });
    if (blVisible) blGroup.addTo(map);
  })
  .catch(function (e) {
    console.error("Bundeslaender GeoJSON Fehler:", e);
  });

function toggleBundeslaender() {
  blVisible = !blVisible;
  var btn = document.getElementById("blToggleBtn");
  if (blVisible) {
    map.addLayer(blGroup);
    if (btn) {
      btn.textContent = "Bundesländer ausblenden";
      btn.style.background = "#27ae60";
    }
  } else {
    map.removeLayer(blGroup);
    if (btn) {
      btn.textContent = "Bundesländer anzeigen";
      btn.style.background = "";
    }
  }
}

// ===== Terminkoenig-Logo bei Leer, verlinkt auf die Terminkoenig-Homepage =====
var terminkoenigIcon = L.icon({
  iconUrl: "terminkoenig_logo.png",
  iconSize: [110, 23],
  iconAnchor: [55, 11],
  className: "terminkoenig-logo-marker"
});
L.marker([53.2308, 7.4528], {
  icon: terminkoenigIcon,
  title: "Terminkönig",
  zIndexOffset: 1000
})
  .addTo(map)
  .on("click", function () {
    window.open("https://www.terminkoenig.de/", "_blank");
  });

// ===== Kalender =====
var PLZ3_STAAT={"010":"SN","011":"SN","012":"SN","013":"SN","014":"SN","015":"SN","016":"SN","017":"SN","018":"SN","019":"BB","026":"SN","027":"SN","028":"SN","029":"SN","030":"BB","031":"BB","032":"BB","041":"SN","042":"SN","043":"SN","044":"SN","045":"SN","046":"TH","047":"SN","048":"SN","049":"BB","061":"ST","062":"ST","063":"ST","064":"ST","065":"ST","066":"ST","067":"ST","068":"ST","069":"ST","073":"TH","074":"TH","075":"TH","076":"TH","077":"TH","078":"TH","079":"TH","080":"SN","081":"SN","082":"SN","083":"SN","084":"SN","085":"SN","086":"SN","091":"SN","092":"SN","093":"SN","094":"SN","095":"SN","096":"SN","101":"BE","102":"BE","103":"BE","104":"BE","105":"BE","106":"BE","107":"BE","108":"BE","109":"BE","120":"BE","121":"BE","122":"BE","123":"BE","124":"BE","125":"BE","126":"BE","130":"BE","131":"BE","133":"BE","134":"BE","135":"BE","136":"BE","140":"BE","141":"BE","144":"BB","145":"BB","146":"BB","147":"BB","148":"BB","149":"BB","152":"BB","153":"BB","155":"BB","157":"BB","158":"BB","159":"BB","162":"BB","163":"BB","165":"BB","167":"BB","168":"BB","169":"BB","170":"MV","171":"MV","172":"MV","173":"MV","174":"MV","175":"MV","180":"MV","181":"MV","182":"MV","183":"MV","184":"MV","185":"MV","186":"MV","190":"MV","192":"MV","193":"MV","194":"MV","200":"HH","201":"HH","202":"HH","203":"HH","204":"HH","205":"HH","210":"HH","211":"HH","212":"NI","213":"NI","214":"NI","215":"SH","216":"NI","217":"NI","220":"HH","221":"HH","222":"HH","223":"HH","224":"HH","225":"HH","226":"HH","227":"HH","228":"SH","229":"SH","235":"SH","236":"SH","237":"SH","238":"SH","239":"MV","241":"SH","242":"SH","243":"SH","244":"SH","245":"SH","246":"SH","247":"SH","248":"SH","249":"SH","253":"SH","254":"SH","255":"SH","256":"SH","257":"SH","258":"SH","259":"SH","261":"NI","262":"NI","263":"NI","264":"NI","265":"NI","266":"NI","267":"NI","268":"NI","269":"NI","272":"NI","273":"NI","274":"NI","275":"HB","276":"NI","277":"NI","278":"NI","281":"HB","282":"HB","283":"HB","287":"HB","288":"NI","292":"NI","293":"NI","294":"NI","295":"NI","296":"NI","301":"NI","304":"NI","305":"NI","306":"NI","308":"NI","309":"NI","310":"NI","311":"NI","312":"NI","313":"NI","315":"NI","316":"NI","317":"NI","318":"NI","320":"NW","321":"NW","322":"NW","323":"NW","324":"NW","325":"NW","326":"NW","327":"NW","328":"NW","330":"NW","331":"NW","333":"NW","334":"NW","336":"NW","337":"NW","338":"NW","341":"HE","342":"HE","343":"HE","344":"HE","345":"HE","346":"HE","350":"HE","351":"HE","352":"HE","353":"HE","354":"HE","355":"HE","356":"HE","357":"HE","360":"HE","361":"HE","362":"HE","363":"HE","364":"TH","370":"NI","371":"NI","372":"HE","373":"TH","374":"NI","375":"NI","376":"NI","381":"NI","382":"NI","383":"NI","384":"NI","385":"NI","386":"NI","387":"NI","388":"ST","391":"ST","392":"ST","393":"ST","394":"ST","395":"ST","396":"ST","402":"NW","404":"NW","405":"NW","406":"NW","407":"NW","408":"NW","410":"NW","411":"NW","412":"NW","413":"NW","414":"NW","415":"NW","417":"NW","418":"NW","421":"NW","422":"NW","423":"NW","424":"NW","425":"NW","426":"NW","427":"NW","428":"NW","429":"NW","441":"NW","442":"NW","443":"NW","445":"NW","446":"NW","447":"NW","448":"NW","451":"NW","452":"NW","453":"NW","454":"NW","455":"NW","456":"NW","457":"NW","458":"NW","459":"NW","460":"NW","461":"NW","462":"NW","463":"NW","464":"NW","465":"NW","470":"NW","471":"NW","472":"NW","474":"NW","475":"NW","476":"NW","477":"NW","478":"NW","479":"NW","481":"NW","482":"NW","483":"NW","484":"NW","485":"NI","486":"NW","487":"NW","490":"NI","491":"NI","492":"NI","493":"NI","494":"NI","495":"NI","496":"NI","497":"NI","498":"NI","501":"NW","502":"NW","503":"NW","506":"NW","507":"NW","508":"NW","509":"NW","510":"NW","511":"NW","513":"NW","514":"NW","515":"NW","516":"NW","517":"NW","520":"NW","521":"NW","522":"NW","523":"NW","524":"NW","525":"NW","531":"NW","532":"NW","533":"NW","534":"RP","535":"RP","536":"NW","537":"NW","538":"NW","539":"NW","542":"RP","543":"RP","544":"RP","545":"RP","546":"RP","551":"RP","552":"RP","554":"RP","555":"RP","556":"RP","557":"RP","560":"RP","561":"RP","562":"RP","563":"RP","564":"RP","565":"RP","566":"RP","567":"RP","568":"RP","570":"NW","572":"NW","573":"NW","574":"NW","575":"RP","576":"RP","580":"NW","581":"NW","582":"NW","583":"NW","584":"NW","585":"NW","586":"NW","587":"NW","588":"NW","590":"NW","591":"NW","592":"NW","593":"NW","594":"NW","595":"NW","596":"NW","597":"NW","598":"NW","599":"NW","603":"HE","604":"HE","605":"HE","611":"HE","612":"HE","613":"HE","614":"HE","630":"HE","631":"HE","632":"HE","633":"HE","634":"HE","635":"HE","636":"HE","637":"BY","638":"BY","639":"BY","642":"HE","643":"HE","644":"HE","645":"HE","646":"HE","647":"HE","648":"HE","651":"HE","652":"HE","653":"HE","654":"HE","655":"HE","656":"HE","657":"HE","658":"HE","659":"HE","661":"SL","662":"SL","663":"SL","664":"SL","665":"SL","666":"SL","667":"SL","668":"RP","669":"RP","670":"RP","671":"RP","672":"RP","673":"RP","674":"RP","675":"RP","676":"RP","677":"RP","678":"RP","681":"BW","682":"BW","683":"BW","685":"BW","686":"HE","687":"BW","688":"BW","691":"BW","692":"BW","694":"BW","695":"HE","701":"BW","703":"BW","704":"BW","705":"BW","706":"BW","707":"BW","708":"BW","710":"BW","711":"BW","712":"BW","713":"BW","714":"BW","715":"BW","716":"BW","717":"BW","720":"BW","721":"BW","722":"BW","723":"BW","724":"BW","725":"BW","726":"BW","727":"BW","728":"BW","730":"BW","731":"BW","732":"BW","733":"BW","734":"BW","735":"BW","736":"BW","737":"BW","740":"BW","741":"BW","742":"BW","743":"BW","744":"BW","745":"BW","746":"BW","747":"BW","748":"BW","749":"BW","750":"BW","751":"BW","752":"BW","753":"BW","754":"BW","761":"BW","762":"BW","763":"BW","764":"BW","765":"BW","766":"BW","767":"RP","768":"RP","776":"BW","777":"BW","778":"BW","779":"BW","780":"BW","781":"BW","782":"BW","783":"BW","784":"BW","785":"BW","786":"BW","787":"BW","790":"BW","791":"BW","792":"BW","793":"BW","794":"BW","795":"BW","796":"BW","797":"BW","798":"BW","803":"BY","804":"BY","805":"BY","806":"BY","807":"BY","808":"BY","809":"BY","812":"BY","813":"BY","814":"BY","815":"BY","816":"BY","817":"BY","818":"BY","819":"BY","820":"BY","821":"BY","822":"BY","823":"BY","824":"BY","825":"BY","830":"BY","831":"BY","832":"BY","833":"BY","834":"BY","835":"BY","836":"BY","837":"BY","840":"BY","841":"BY","843":"BY","844":"BY","845":"BY","850":"BY","851":"BY","852":"BY","853":"BY","854":"BY","855":"BY","856":"BY","857":"BY","861":"BY","863":"BY","864":"BY","865":"BY","866":"BY","867":"BY","868":"BY","869":"BY","874":"BY","875":"BY","876":"BY","877":"BY","880":"BW","881":"BY","882":"BW","883":"BW","884":"BW","885":"BW","886":"BW","887":"BW","890":"BW","891":"BW","892":"BY","893":"BY","894":"BY","895":"BW","896":"BW","904":"BY","905":"BY","906":"BY","907":"BY","910":"BY","911":"BY","912":"BY","913":"BY","914":"BY","915":"BY","916":"BY","917":"BY","918":"BY","922":"BY","923":"BY","924":"BY","925":"BY","926":"BY","927":"BY","930":"BY","931":"BY","933":"BY","934":"BY","940":"BY","941":"BY","942":"BY","943":"BY","944":"BY","945":"BY","950":"BY","951":"BY","952":"BY","953":"BY","954":"BY","955":"BY","956":"BY","957":"BY","960":"BY","961":"BY","962":"BY","963":"BY","964":"BY","965":"TH","970":"BY","971":"BY","972":"BY","973":"BY","974":"BY","975":"BY","976":"BY","977":"BY","978":"BY","979":"BW","985":"TH","986":"TH","987":"TH","990":"TH","991":"TH","993":"TH","994":"TH","995":"TH","996":"TH","997":"TH","998":"TH","999":"TH"};

var calYear=new Date().getFullYear(), calMonth=new Date().getMonth();

function dateKey(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function calEaster(y){
  var a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,
      f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
      h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,
      l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  return new Date(y,Math.floor((h+l-7*m+114)/31)-1,((h+l-7*m+114)%31)+1);
}
function calAddDays(d,n){var r=new Date(d);r.setDate(r.getDate()+n);return r;}
function calBussBettag(y){var d=new Date(y,10,22);while(d.getDay()!==3)d.setDate(d.getDate()-1);return d;}
function calGetHolidays(y){
  var e=calEaster(y);
  var h=[
    {d:new Date(y,0,1),n:'Neujahr',s:'all'},
    {d:new Date(y,0,6),n:'Heilige Drei Könige',s:['BW','BY','ST']},
    {d:new Date(y,2,8),n:'Frauentag',s:['BE','MV']},
    {d:calAddDays(e,-2),n:'Karfreitag',s:'all'},
    {d:calAddDays(e,0),n:'Ostersonntag',s:['BB']},
    {d:calAddDays(e,1),n:'Ostermontag',s:'all'},
    {d:new Date(y,4,1),n:'Tag der Arbeit',s:'all'},
    {d:calAddDays(e,39),n:'Christi Himmelfahrt',s:'all'},
    {d:calAddDays(e,49),n:'Pfingstsonntag',s:['BB']},
    {d:calAddDays(e,50),n:'Pfingstmontag',s:'all'},
    {d:calAddDays(e,60),n:'Fronleichnam',s:['BW','BY','HE','NW','RP','SL']},
    {d:new Date(y,7,15),n:'Mariä Himmelfahrt',s:['BY','SL']},
    {d:new Date(y,8,20),n:'Weltkindertag',s:['TH']},
    {d:new Date(y,9,3),n:'Tag der Deutschen Einheit',s:'all'},
    {d:new Date(y,9,31),n:'Reformationstag',s:['BB','HB','HH','MV','NI','SN','ST','SH','TH']},
    {d:new Date(y,10,1),n:'Allerheiligen',s:['BW','BY','NW','RP','SL']},
    {d:calBussBettag(y),n:'Buß- und Bettag',s:['SN']},
    {d:new Date(y,11,25),n:'1. Weihnachtstag',s:'all'},
    {d:new Date(y,11,26),n:'2. Weihnachtstag',s:'all'}
  ];
  var lk={};
  h.forEach(function(x){lk[dateKey(x.d)]={n:x.n,s:x.s};});
  return lk;
}
function renderCalendar(){
  var el=document.getElementById('cal');
  if(!el)return;
  var today=new Date();
  var hols=calGetHolidays(calYear);
  var MON=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  var DOW=['Mo','Di','Mi','Do','Fr','Sa','So'];
  var html='<div class="cal-nav"><button onclick="calPrev()">&#8249;</button><span>'+MON[calMonth]+' '+calYear+'</span><button onclick="calNext()">&#8250;</button></div>';
  html+='<table class="cal-grid"><tr>';
  DOW.forEach(function(d){html+='<th>'+d+'</th>';});
  html+='</tr><tr>';
  var first=new Date(calYear,calMonth,1).getDay();
  var off=(first+6)%7;
  for(var i=0;i<off;i++)html+='<td></td>';
  var dim=new Date(calYear,calMonth+1,0).getDate();
  for(var day=1;day<=dim;day++){
    var col=(off+day-1)%7;
    if(col===0&&day>1)html+='</tr><tr>';
    var dk=dateKey(new Date(calYear,calMonth,day));
    var isToday=(calYear===today.getFullYear()&&calMonth===today.getMonth()&&day===today.getDate());
    var hol=hols[dk];
    var cls=(isToday?'cal-today ':'')+(hol?'cal-fei':'');
    if(hol){
      html+='<td class="'+cls.trim()+'" title="'+hol.n+'" onclick="selectHolidayPLZ(\''+dk+'\')">'+day+'</td>';
    }else{
      html+='<td'+(cls?' class="'+cls.trim()+'"':'')+' onclick="clearHolidayPLZ()">'+day+'</td>';
    }
  }
  html+='</tr></table>';
  el.innerHTML=html;
}
function calPrev(){if(--calMonth<0){calMonth=11;calYear--;}renderCalendar();}
function calNext(){if(++calMonth>11){calMonth=0;calYear++;}renderCalendar();}
function selectHolidayPLZ(dk){
  var y=parseInt(dk);
  var hols=calGetHolidays(y);
  var hol=hols[dk];
  if(!hol)return;
  var states=hol.s;
  Object.keys(allLayers).forEach(function(p3){
    var st=PLZ3_STAAT[p3];
    if(states==='all'||(st&&states.indexOf(st)>=0)){
      sel[p3]=true;
      selHol[p3]=true;
      refreshLayer(p3);
    }
  });
  updateSidebar();
}
function clearHolidayPLZ(){
  Object.keys(selHol).forEach(function(p3){
    delete sel[p3];
    delete selHol[p3];
    refreshLayer(p3);
  });
  updateSidebar();
}
function getHolidaysForState(state,year){
  var hols=calGetHolidays(year);
  var result=[];
  Object.keys(hols).sort().forEach(function(dk){
    var h=hols[dk];
    if(h.s==='all'||(state&&Array.isArray(h.s)&&h.s.indexOf(state)>=0)){
      var p=dk.split('-');
      result.push(p[2]+'.'+p[1]+'.:'+h.n);
    }
  });
  return result.join('; ');
}
renderCalendar();
