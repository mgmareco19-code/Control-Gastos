/* ============================================================
   Excel (.xlsx) sin librerías: arma el libro y lo descarga.
   Uso:
     Excel.descargar("archivo.xlsx", [
       { nombre: "Hoja", anchos: [12, 30], filtro: true,
         filas: [ [{ v: "Fecha", s: "head" }, { v: "Monto", s: "head" }],
                  [{ v: "2026-11-21", s: "fecha" }, { v: 25000, s: "monto" }] ] },
     ]);
   Una celda puede ser: null, texto, número o { v, s } con s =
   "head" (encabezado verde), "fecha" (v = "AAAA-MM-DD"), "monto" (#.##0),
   "bold", "montoBold" o "titulo".
   La primera fila de una hoja con filtro: true queda fija y con filtro;
   pie: n deja las últimas n filas (totales) fuera del filtro.
   ============================================================ */
window.Excel = (() => {
  const enc = new TextEncoder();
  const ESTILO = { head: 1, fecha: 2, monto: 3, bold: 4, montoBold: 5, titulo: 6 };

  const xml = (s) => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /** A, B, … Z, AA, AB… */
  const col = (i) => { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

  /** "2026-11-21" → número de serie de Excel */
  const serial = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  };

  function celda(c, ref) {
    if (c === null || c === undefined || c === "") return "";
    const o = typeof c === "object" ? c : { v: c };
    if (o.v === null || o.v === undefined || o.v === "") return o.s ? `<c r="${ref}" s="${ESTILO[o.s]}"/>` : "";
    const s = o.s ? ` s="${ESTILO[o.s]}"` : "";
    if (o.s === "fecha" && /^\d{4}-\d{2}-\d{2}/.test(o.v)) return `<c r="${ref}"${s}><v>${serial(String(o.v).slice(0, 10))}</v></c>`;
    if (typeof o.v === "number" && isFinite(o.v)) return `<c r="${ref}"${s}><v>${o.v}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(o.v)}</t></is></c>`;
  }

  function hojaXml(h) {
    const ncols = Math.max(1, ...h.filas.map((f) => f.length));
    const vista = h.filtro
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
    const cols = h.anchos ? `<cols>${h.anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const filas = h.filas.map((f, r) => `<row r="${r + 1}">${f.map((c, i) => celda(c, `${col(i)}${r + 1}`)).join("")}</row>`).join("");
    const nf = h.filas.length - (h.pie || 0);
    const filtro = h.filtro && nf > 1 ? `<autoFilter ref="A1:${col(ncols - 1)}${nf}"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${vista}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${filas}</sheetData>${filtro}</worksheet>`;
  }

  const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="15"/><color rgb="FF0B7A5A"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B7A5A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  /** Nombre de hoja válido para Excel (máx. 31, sin : \ / ? * [ ]) y sin repetir */
  function nombresHojas(hojas) {
    const usados = new Set();
    return hojas.map((h, i) => {
      let n = String(h.nombre || `Hoja${i + 1}`).replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || `Hoja${i + 1}`;
      let k = n, j = 2;
      while (usados.has(k.toLowerCase())) k = `${n.slice(0, 28)} ${j++}`;
      usados.add(k.toLowerCase());
      return k;
    });
  }

  function archivos(hojas) {
    const nombres = nombresHojas(hojas);
    const defs = hojas.map((h, i) => {
      const nf = h.filas.length - (h.pie || 0);
      if (!h.filtro || nf < 2) return "";
      const ncols = Math.max(1, ...h.filas.map((f) => f.length));
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(nombres[i].replace(/'/g, "''"))}'!$A$1:$${col(ncols - 1)}$${nf}</definedName>`;
    }).join("");
    const f = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${defs ? `<definedNames>${defs}</definedNames>` : ""}</workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "xl/styles.xml": ESTILOS,
    };
    hojas.forEach((h, i) => { f[`xl/worksheets/sheet${i + 1}.xml`] = hojaXml(h); });
    return f;
  }

  /* ---------- ZIP sin compresión ---------- */
  const TABLA = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = TABLA[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  function zip(files) {
    const d = new Date();
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const partes = [], central = [];
    let off = 0;
    for (const [nombre, texto] of Object.entries(files)) {
      const n = enc.encode(nombre), b = enc.encode(texto), crc = crc32(b);
      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
      loc.setUint16(10, hora, true); loc.setUint16(12, dia, true); loc.setUint32(14, crc, true);
      loc.setUint32(18, b.length, true); loc.setUint32(22, b.length, true); loc.setUint16(26, n.length, true); loc.setUint16(28, 0, true);
      partes.push(new Uint8Array(loc.buffer), n, b);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
      cen.setUint16(12, hora, true); cen.setUint16(14, dia, true); cen.setUint32(16, crc, true);
      cen.setUint32(20, b.length, true); cen.setUint32(24, b.length, true); cen.setUint16(28, n.length, true);
      cen.setUint32(42, off, true);
      central.push(new Uint8Array(cen.buffer), n);
      off += 30 + n.length + b.length;
    }
    const tam = central.reduce((s, x) => s + x.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    const cant = Object.keys(files).length;
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, cant, true); fin.setUint16(10, cant, true);
    fin.setUint32(12, tam, true); fin.setUint32(16, off, true);
    return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function crear(hojas) { return zip(archivos(hojas)); }

  function descargar(nombre, hojas) {
    const blob = crear(hojas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombre; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return blob;
  }

  return { crear, descargar, archivos };
})();
