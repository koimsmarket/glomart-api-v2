'use strict';

const crypto = require('crypto');
const zlib = require('zlib');

const VERSION = 'GM_BANK_WOORI_XLSX_V001';

function sha256(value){
  return crypto.createHash('sha256').update(value).digest('hex');
}

function xmlDecode(v){
  return String(v == null ? '' : v)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function findEocd(buf){
  const min = Math.max(0, buf.length - 0xFFFF - 22);
  for(let i = buf.length - 22; i >= min; i--){
    if(buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('invalid xlsx/zip: EOCD not found');
}

function readZipEntries(buf){
  const eocd = findEocd(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let p = cdOffset;
  for(let i=0; i<entryCount; i++){
    if(buf.readUInt32LE(p) !== 0x02014b50) throw new Error('invalid xlsx/zip: central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    if(buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('invalid xlsx/zip: local entry');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.slice(dataStart, dataStart + compressedSize);
    let data;
    if(method === 0) data = compressed;
    else if(method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error('unsupported xlsx compression method: ' + method);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function sharedStrings(entries){
  const data = entries.get('xl/sharedStrings.xml');
  if(!data) return [];
  const xml = data.toString('utf8');
  const result = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m;
  while((m = re.exec(xml))){
    const parts = [];
    const tr = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let t;
    while((t = tr.exec(m[1]))) parts.push(xmlDecode(t[1]));
    result.push(parts.join(''));
  }
  return result;
}

function firstSheetPath(entries){
  const wb = entries.get('xl/workbook.xml');
  const rel = entries.get('xl/_rels/workbook.xml.rels');
  if(!wb || !rel) return 'xl/worksheets/sheet1.xml';
  const wbXml = wb.toString('utf8');
  const relXml = rel.toString('utf8');
  const sm = wbXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if(!sm) return 'xl/worksheets/sheet1.xml';
  const rid = sm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rr = new RegExp('<Relationship\\b[^>]*\\bId="' + rid + '"[^>]*\\bTarget="([^"]+)"[^>]*/?>');
  const rm = relXml.match(rr);
  if(!rm) return 'xl/worksheets/sheet1.xml';
  const target = rm[1].replace(/^\/+/, '');
  return target.startsWith('xl/') ? target : 'xl/' + target.replace(/^\.\//, '');
}

function colIndex(ref){
  const m = String(ref || '').match(/^([A-Z]+)/i);
  if(!m) return -1;
  let n = 0;
  for(const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(entries){
  const strings = sharedStrings(entries);
  const path = firstSheetPath(entries);
  const data = entries.get(path) || entries.get('xl/worksheets/sheet1.xml');
  if(!data) throw new Error('xlsx sheet xml not found');
  const xml = data.toString('utf8');
  const rows = [];
  const rr = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm;
  while((rm = rr.exec(xml))){
    const rowNoMatch = rm[1].match(/\br="(\d+)"/);
    const rowNo = rowNoMatch ? Number(rowNoMatch[1]) : rows.length + 1;
    const cells = [];
    const cr = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while((cm = cr.exec(rm[2]))){
      const attrs = cm[1];
      const body = cm[2];
      const refm = attrs.match(/\br="([A-Z]+\d+)"/i);
      const idx = refm ? colIndex(refm[1]) : cells.length;
      const tm = attrs.match(/\bt="([^"]+)"/);
      const type = tm ? tm[1] : '';
      let value = '';
      if(type === 'inlineStr'){
        const im = body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
        value = im ? xmlDecode(im[1]) : '';
      }else{
        const vm = body.match(/<v>([\s\S]*?)<\/v>/);
        const raw = vm ? xmlDecode(vm[1]) : '';
        if(type === 's') value = strings[Number(raw)] == null ? '' : strings[Number(raw)];
        else if(type === 'str') value = raw;
        else if(type === 'b') value = raw === '1';
        else if(raw !== '' && /^-?\d+(?:\.\d+)?$/.test(raw)) value = Number(raw);
        else value = raw;
      }
      cells[idx] = value;
    }
    rows[rowNo - 1] = cells;
  }
  return rows;
}

function text(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim(); }
function amount(v){
  if(typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const s = text(v).replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function normDateTime(v){
  const s = text(v).replace(/[.\/]/g, '-');
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if(!m) return text(v);
  const p = n => String(n).padStart(2, '0');
  return `${m[1]}-${p(m[2])}-${p(m[3])} ${p(m[4])}:${p(m[5])}:${p(m[6] || 0)}`;
}

const HEADER = ['No.','거래일시','적요','기재내용','지급(원)','입금(원)','거래후 잔액(원)','취급점','메모','수표·어음·증권금액(원)'];

function parseWooriXlsx(buffer){
  if(!Buffer.isBuffer(buffer) || buffer.length < 100) throw new Error('xlsx buffer required');
  const entries = readZipEntries(buffer);
  const rows = parseSheet(entries);
  const firstText = rows.slice(0, 8).flat().map(text).join(' ');
  if(!/우리은행\s*거래내역조회/.test(firstText)) throw new Error('WOORI format mismatch: title not found');

  let headerIndex = -1;
  for(let i=0; i<Math.min(rows.length, 30); i++){
    const row = rows[i] || [];
    const names = HEADER.map((_, j) => text(row[j]));
    if(HEADER.every((h, j) => names[j] === h)){ headerIndex = i; break; }
  }
  if(headerIndex < 0) throw new Error('WOORI format mismatch: expected header row not found');

  // Woori exports the title/account/query rows as merged cells.
  // Read only the first cell of each metadata row so merged-cell repetitions do not pollute values.
  const metaLines = rows.slice(0, headerIndex).map(r => text((r || [])[0])).filter(Boolean);
  const metaText = metaLines.join(' ');
  const accountLine = metaLines.find(v => /계좌번호\s*:/.test(v)) || '';
  const queryLine = metaLines.find(v => /조회기간\s*:/.test(v)) || '';
  const acc = accountLine.match(/계좌번호\s*:\s*([0-9\-]+)/);
  const holder = accountLine.match(/예금주\s*:\s*(.+)$/);
  const period = queryLine.match(/조회기간\s*:\s*(\d{4}[.\-]\d{2}[.\-]\d{2})\s*~\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/);
  const queried = queryLine.match(/조회일시\s*:\s*(\d{4}[.\-]\d{2}[.\-]\d{2}\s+\d{2}:\d{2}:\d{2})/);
  const accountNo = acc ? acc[1].replace(/\D/g, '') : '';
  const accountHolder = holder ? text(holder[1]) : '';

  const transactions = [];
  for(let i=headerIndex+1; i<rows.length; i++){
    const r = rows[i] || [];
    if(r.every(v => text(v) === '')) continue;
    const no = amount(r[0]);
    const transactionAt = normDateTime(r[1]);
    const transactionType = text(r[2]);
    const description = text(r[3]);
    const withdrawAmount = amount(r[4]);
    const depositAmount = amount(r[5]);
    const balanceAmount = amount(r[6]);
    const branchName = text(r[7]);
    const bankMemo = text(r[8]);
    const instrumentAmount = amount(r[9]);
    if(!transactionAt || (!withdrawAmount && !depositAmount && !balanceAmount && !description)) continue;
    const hashInput = [
      'WOORI', accountNo, transactionAt, transactionType, description,
      withdrawAmount, depositAmount, balanceAmount, branchName, instrumentAmount
    ].join('|');
    transactions.push({
      source_row_no: i + 1,
      bank_row_no: no || null,
      transaction_at: transactionAt,
      transaction_type: transactionType,
      description,
      withdraw_amount: withdrawAmount,
      deposit_amount: depositAmount,
      balance_amount: balanceAmount,
      branch_name: branchName,
      bank_memo: bankMemo,
      instrument_amount: instrumentAmount,
      transaction_hash: sha256(hashInput),
      raw: {
        no: r[0], transaction_at: r[1], transaction_type: r[2], description: r[3],
        withdraw_amount: r[4], deposit_amount: r[5], balance_amount: r[6],
        branch_name: r[7], bank_memo: r[8], instrument_amount: r[9]
      }
    });
  }

  return {
    version: VERSION,
    bank_code: 'WOORI',
    account_no: accountNo,
    account_holder: accountHolder,
    query_start: period ? period[1].replace(/\./g,'-') : '',
    query_end: period ? period[2].replace(/\./g,'-') : '',
    queried_at: queried ? normDateTime(queried[1]) : '',
    header_row_no: headerIndex + 1,
    transactions
  };
}

module.exports = { VERSION, parseWooriXlsx, sha256 };
