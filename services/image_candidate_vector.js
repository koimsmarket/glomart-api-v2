'use strict';
/* GM_IMAGE_CANDIDATE_VECTOR_V001
 * Compact search-candidate representation derived from the existing 512-d image embedding.
 * No image download / MobileCLIP inference is performed here.
 *
 * BYTEA layout (519 bytes total):
 *   byte 0      : format version = 1
 *   bytes 1..2  : uint16 LE dimensions = 512
 *   bytes 3..6  : float32 LE scale (normalized maxAbs / 127)
 *   bytes 7..518: 512 signed int8 values
 *
 * The source vector is L2-normalized before symmetric INT8 quantization.
 * candidate_vector is only for ANN candidate retrieval; vector_image remains the exact source of truth.
 */
const DIM=512;
const FORMAT_VERSION=1;
const HEADER_BYTES=7;
const BYTE_LEN=HEADER_BYTES+DIM;

function encodeCandidateVector(raw){
  if(!raw||typeof raw.length!=='number'||raw.length!==DIM)return null;
  const normalized=new Float64Array(DIM);
  let normSq=0;
  for(let i=0;i<DIM;i++){
    const x=Number(raw[i]);
    if(!Number.isFinite(x))return null;
    normalized[i]=x;
    normSq+=x*x;
  }
  if(!(normSq>0))return null;
  const invNorm=1/Math.sqrt(normSq);
  let maxAbs=0;
  for(let i=0;i<DIM;i++){
    const x=normalized[i]*invNorm;
    normalized[i]=x;
    const a=Math.abs(x);
    if(a>maxAbs)maxAbs=a;
  }
  if(!(maxAbs>0))return null;
  const scale=maxAbs/127;
  const out=Buffer.allocUnsafe(BYTE_LEN);
  out.writeUInt8(FORMAT_VERSION,0);
  out.writeUInt16LE(DIM,1);
  out.writeFloatLE(scale,3);
  for(let i=0;i<DIM;i++){
    let q=Math.round(normalized[i]/scale);
    if(q>127)q=127;
    else if(q<-127)q=-127;
    out.writeInt8(q,HEADER_BYTES+i);
  }
  return out;
}

function decodeCandidateVector(buf){
  if(!Buffer.isBuffer(buf))buf=Buffer.from(buf||[]);
  if(buf.length!==BYTE_LEN)return null;
  if(buf.readUInt8(0)!==FORMAT_VERSION||buf.readUInt16LE(1)!==DIM)return null;
  const scale=buf.readFloatLE(3);
  if(!Number.isFinite(scale)||!(scale>0))return null;
  const out=new Float32Array(DIM);
  for(let i=0;i<DIM;i++)out[i]=buf.readInt8(HEADER_BYTES+i)*scale;
  return out;
}

module.exports={
  DIM,
  FORMAT_VERSION,
  HEADER_BYTES,
  BYTE_LEN,
  encodeCandidateVector,
  decodeCandidateVector
};
