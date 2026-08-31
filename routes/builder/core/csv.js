function clean(v) {
  return String(v ?? '').replace(/^\ufeff/, '').trim();
}
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCsv(rows, columns) {
  const lines = [columns.map(csvEscape).join(',')];
  for (const r of rows) lines.push(columns.map(c => csvEscape(r[c])).join(','));
  return '\ufeff' + lines.join('\n');
}

// GM_BUILDER_EXPORT_ALL_ZIP_V001
// 외부 라이브러리 없이 CSV 여러 개를 ZIP으로 묶는다.
function crc32Buffer(buf){
  let table = crc32Buffer.table;
  if(!table){
    table = crc32Buffer.table = new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c=i;
      for(let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i]=c>>>0;
    }
  }
  let crc = 0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(d=new Date()){
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds()/2) & 31);
  const date = (((d.getFullYear()-1980) & 127) << 9) | (((d.getMonth()+1) & 15) << 5) | (d.getDate() & 31);
  return {time,date};
}
function u16(n){ const b=Buffer.alloc(2); b.writeUInt16LE(n & 0xFFFF,0); return b; }
function u32(n){ const b=Buffer.alloc(4); b.writeUInt32LE(n >>> 0,0); return b; }
function makeZip(files){
  const local=[], central=[];
  let offset=0;
  const dt=dosDateTime();
  for(const f of files){
    const nameBuf=Buffer.from(f.name,'utf8');
    const data=Buffer.isBuffer(f.data)?f.data:Buffer.from(String(f.data||''),'utf8');
    const crc=crc32Buffer(data);
    const lh=Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(dt.time), u16(dt.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf
    ]);
    local.push(lh,data);
    const ch=Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dt.time), u16(dt.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBuf
    ]);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const centralSize=central.reduce((a,b)=>a+b.length,0);
  const end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(centralSize),u32(offset),u16(0)]);
  return Buffer.concat([...local,...central,end]);
}
function parseCsv(text) {
  text = String(text || '').replace(/^\ufeff/, '');
  const rows = [];
  let row = [], cell = '', quote = false;
  for (let i=0; i<text.length; i++) {
    const ch = text[i], nx = text[i+1];
    if (quote) {
      if (ch === '"' && nx === '"') { cell += '"'; i++; }
      else if (ch === '"') quote = false;
      else cell += ch;
    } else {
      if (ch === '"') quote = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row=[]; cell=''; }
      else if (ch !== '\r') cell += ch;
    }
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  if (!rows.length) return [];
  const header = rows.shift().map(h => clean(h));
  return rows
    .filter(r => r.some(v => clean(v) !== ''))
    .map((r, idx) => {
      const o = { __row_no: idx + 2 };
      header.forEach((h,i)=>{ if (h) o[h] = r[i] ?? ''; });
      return o;
    });
}

module.exports = { clean, csvEscape, toCsv, makeZip, parseCsv };
