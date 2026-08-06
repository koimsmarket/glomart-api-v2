'use strict';

const DELETE_TARGETS = Object.freeze({
  item: { table:'gm_smartfit_item', where:'template_id=$1' },
  delta: { table:'gm_smartfit_collection_item_delta', where:'template_id=$1', optional:true },
  receiver: { table:'gm_smartfit_message_receiver', where:'template_id=$1', optional:true },
  collection: { table:'gm_smartfit_collection', where:'template_id=$1', optional:true },
  keyword: { table:'gm_smartfit_template_keyword', where:'template_id=$1', optional:true },
  event: { table:'gm_smartfit_event', where:'template_id=$1', optional:true },
  comment: { table:'gm_smartfit_comment', where:'template_id=$1', optional:true },
  template: { table:'gm_smartfit_template', where:'template_id=$1' },
  space: { table:'gm_smartfit_space', where:'space_id=$1' }
});

function num(v,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function str(v){ return v===undefined||v===null?'':String(v).trim(); }
function nowMs(){ return Date.now(); }

module.exports = function createSmartfitDeleteService(deps){
  const r2=deps.r2;
  const isOwnerOrAdmin=deps.isOwnerOrAdmin;
  const getTemplateCollectionLock=deps.getTemplateCollectionLock;
  if(!r2 || typeof isOwnerOrAdmin!=='function' || typeof getTemplateCollectionLock!=='function') throw new Error('smartfit delete service dependencies required');

  function notFound(e){
    const code=String((e&&e.name)||(e&&e.Code)||(e&&e.code)||'').toUpperCase();
    const status=Number((e&&e.$metadata&&e.$metadata.httpStatusCode)||(e&&e.statusCode)||(e&&e.status)||0);
    return status===404 || code==='NOTFOUND' || code==='NOSUCHKEY' || code==='NO_SUCH_KEY';
  }

  function log(kind, id, step, data, startedAt){
    const payload=Object.assign({step, id, elapsed_ms:Math.max(0,nowMs()-startedAt)},data||{});
    console.log(`[SMARTFIT_${kind}_DELETE]`, payload);
  }

  function wrapError(e,state){
    if(e && typeof e==='object') e.deleteState=Object.assign({},state);
    return e;
  }

  async function tableExists(client, tableName){
    const r=await client.query('SELECT to_regclass($1) AS name',[`public.${tableName}`]);
    return !!(r.rows[0]&&r.rows[0].name);
  }

  async function countTarget(client, targetName, id){
    const target=DELETE_TARGETS[targetName];
    if(!target) throw new Error(`unknown delete target: ${targetName}`);
    if(target.optional && !(await tableExists(client,target.table))) return 0;
    const r=await client.query(`SELECT COUNT(*)::int AS n FROM ${target.table} WHERE ${target.where}`,[id]);
    return num((r.rows[0]||{}).n,0);
  }

  async function lockTargetRows(client, targetName, id, columns='*'){
    const target=DELETE_TARGETS[targetName];
    if(!target) throw new Error(`unknown delete target: ${targetName}`);
    if(target.optional && !(await tableExists(client,target.table))) return [];
    const r=await client.query(`SELECT ${columns} FROM ${target.table} WHERE ${target.where} FOR UPDATE`,[id]);
    return r.rows;
  }

  async function deleteAndVerify(client, targetName, id, ctx){
    const target=DELETE_TARGETS[targetName];
    if(!target) throw new Error(`unknown delete target: ${targetName}`);
    const exists=!target.optional || await tableExists(client,target.table);
    if(!exists){
      log(ctx.kind,ctx.id,ctx.step,{table:target.table,expected:0,deleted:0,remaining:0,skipped:true},ctx.startedAt);
      return {expected:0,deleted:0,remaining:0,skipped:true};
    }
    const expected=await countTarget(client,targetName,id);
    const d=await client.query(`DELETE FROM ${target.table} WHERE ${target.where}`,[id]);
    const deleted=d.rowCount;
    const remaining=await countTarget(client,targetName,id);
    log(ctx.kind,ctx.id,ctx.step,{table:target.table,expected,deleted,remaining},ctx.startedAt);
    if(deleted!==expected) throw new Error(`${target.table} delete count mismatch: expected=${expected}, deleted=${deleted}`);
    if(remaining!==0) throw new Error(`${target.table} delete incomplete: remained=${remaining}`);
    return {expected,deleted,remaining};
  }

  async function deleteR2KeysVerified(keys,ctx){
    const list=Array.from(new Set((keys||[]).filter(Boolean)));
    if(!list.length){ log(ctx.kind,ctx.id,ctx.step,{requested:0,verified:0,remaining:0},ctx.startedAt); return {requested:0,verified:0,remaining:0}; }
    await r2.deleteKeys(list);
    const remained=[];
    for(const key of list){
      try{ await r2.headObject(key); remained.push(key); }
      catch(e){ if(!notFound(e)) throw e; }
    }
    log(ctx.kind,ctx.id,ctx.step,{requested:list.length,verified:list.length-remained.length,remaining:remained.length},ctx.startedAt);
    if(remained.length) throw new Error(`r2 image delete verification failed: remained=${remained.length}`);
    return {requested:list.length,verified:list.length,remaining:0};
  }

  async function deleteTemplateMedia(client,templateId,ctx){
    if(!(await tableExists(client,'gm_smartfit_media'))){
      log(ctx.kind,ctx.id,ctx.step,{table:'gm_smartfit_media/TEMPLATE',expected:0,deleted:0,remaining:0,skipped:true},ctx.startedAt);
      return {expected:0,deleted:0,remaining:0,skipped:true};
    }
    const expected=num(((await client.query(`SELECT COUNT(*)::int AS n FROM gm_smartfit_media WHERE UPPER(target_type)='TEMPLATE' AND target_id=$1`,[String(templateId)])).rows[0]||{}).n,0);
    const d=await client.query(`DELETE FROM gm_smartfit_media WHERE UPPER(target_type)='TEMPLATE' AND target_id=$1`,[String(templateId)]);
    const remaining=num(((await client.query(`SELECT COUNT(*)::int AS n FROM gm_smartfit_media WHERE UPPER(target_type)='TEMPLATE' AND target_id=$1`,[String(templateId)])).rows[0]||{}).n,0);
    log(ctx.kind,ctx.id,ctx.step,{table:'gm_smartfit_media/TEMPLATE',expected,deleted:d.rowCount,remaining},ctx.startedAt);
    if(d.rowCount!==expected || remaining!==0) throw new Error(`gm_smartfit_media template delete incomplete: expected=${expected}, deleted=${d.rowCount}, remained=${remaining}`);
    return {expected,deleted:d.rowCount,remaining};
  }

  async function lockAndValidateComments(client,templateId,ctx){
    const rows=await lockTargetRows(client,'comment',templateId,'*');
    const withImages=rows.filter(x=>num(x.image_count,0)>0);
    log(ctx.kind,ctx.id,ctx.step,{comments:rows.length,comments_with_images:withImages.length},ctx.startedAt);
    if(withImages.length) throw new Error(`template comment image cleanup required before permanent delete: comments=${withImages.length}`);
    return rows.map(x=>String(x.comment_id)).filter(Boolean);
  }

  async function deleteCommentMedia(client,commentIds,ctx){
    if(!commentIds.length || !(await tableExists(client,'gm_smartfit_media'))){
      log(ctx.kind,ctx.id,ctx.step,{table:'gm_smartfit_media/COMMENT',expected:0,deleted:0,remaining:0,skipped:true},ctx.startedAt);
      return {expected:0,deleted:0,remaining:0,skipped:true};
    }
    const expected=num(((await client.query(`SELECT COUNT(*)::int AS n FROM gm_smartfit_media WHERE UPPER(target_type)='COMMENT' AND target_id = ANY($1::text[])`,[commentIds])).rows[0]||{}).n,0);
    const d=await client.query(`DELETE FROM gm_smartfit_media WHERE UPPER(target_type)='COMMENT' AND target_id = ANY($1::text[])`,[commentIds]);
    const remaining=num(((await client.query(`SELECT COUNT(*)::int AS n FROM gm_smartfit_media WHERE UPPER(target_type)='COMMENT' AND target_id = ANY($1::text[])`,[commentIds])).rows[0]||{}).n,0);
    log(ctx.kind,ctx.id,ctx.step,{table:'gm_smartfit_media/COMMENT',expected,deleted:d.rowCount,remaining},ctx.startedAt);
    if(d.rowCount!==expected || remaining!==0) throw new Error(`gm_smartfit_media comment delete incomplete: expected=${expected}, deleted=${d.rowCount}, remained=${remaining}`);
    return {expected,deleted:d.rowCount,remaining};
  }

  async function deleteMessageQueue(client,templateId,ctx){
    if(!(await tableExists(client,'gm_event_queue'))){
      log(ctx.kind,ctx.id,ctx.step,{table:'gm_event_queue',expected:0,deleted:0,remaining:0,skipped:true},ctx.startedAt);
      return {expected:0,deleted:0,remaining:0,skipped:true};
    }
    const where=`event_type='SMARTFIT_MESSAGE_SEND' AND COALESCE(payload->>'template_id','')=$1`;
    const expected=num(((await client.query(`SELECT COUNT(*)::int AS n FROM gm_event_queue WHERE ${where}`,[String(templateId)])).rows[0]||{}).n,0);
    const d=await client.query(`DELETE FROM gm_event_queue WHERE ${where}`,[String(templateId)]);
    const remaining=num(((await client.query(`SELECT COUNT(*)::int AS n FROM gm_event_queue WHERE ${where}`,[String(templateId)])).rows[0]||{}).n,0);
    log(ctx.kind,ctx.id,ctx.step,{table:'gm_event_queue',expected,deleted:d.rowCount,remaining},ctx.startedAt);
    if(d.rowCount!==expected || remaining!==0) throw new Error(`gm_event_queue cleanup incomplete: expected=${expected}, deleted=${d.rowCount}, remained=${remaining}`);
    return {expected,deleted:d.rowCount,remaining};
  }

  async function deleteSpace(client,member,spaceId){
    const startedAt=nowMs();
    const state={image_deleted:false,db_deleted:false};
    const ctx={kind:'SPACE',id:spaceId,startedAt,step:''};
    try{
      log('SPACE',spaceId,'START',{member_id:member},startedAt);
      const old=(await client.query('SELECT * FROM gm_smartfit_space WHERE space_id=$1 FOR UPDATE',[spaceId])).rows[0];
      if(!old) throw new Error('space not found');
      if(!(await isOwnerOrAdmin(client,member,old.owner_member_id||old.creator_member_id))) throw new Error('permission denied');
      if(String(old.is_deleted||'F').toUpperCase()!=='T') throw new Error('space must be in trash before permanent delete');
      log('SPACE',spaceId,'LOCK',{locked:true},startedAt);

      const linked=(await client.query('SELECT template_id FROM gm_smartfit_template WHERE space_id=$1 FOR UPDATE',[spaceId])).rows;
      const detached=await client.query('UPDATE gm_smartfit_template SET space_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE space_id=$1 RETURNING template_id',[spaceId]);
      const remained=num(((await client.query('SELECT COUNT(*)::int AS n FROM gm_smartfit_template WHERE space_id=$1',[spaceId])).rows[0]||{}).n,0);
      log('SPACE',spaceId,'DETACH_TEMPLATE',{expected:linked.length,deleted:detached.rowCount,remaining:remained},startedAt);
      if(detached.rowCount!==linked.length || remained!==0) throw new Error(`space template detach incomplete: expected=${linked.length}, updated=${detached.rowCount}, remained=${remained}`);

      const keys=[];
      for(let imageNo=1;imageNo<=r2.RESERVED_IMAGES_PER_ID;imageNo++) keys.push(r2.keyFor('space',spaceId,imageNo,'image'),r2.keyFor('space',spaceId,imageNo,'small'));
      const image=await deleteR2KeysVerified(keys,Object.assign({},ctx,{step:'IMAGE'}));
      state.image_deleted=true;

      const db=await deleteAndVerify(client,'space',spaceId,Object.assign({},ctx,{step:'SPACE_DB'}));
      state.db_deleted=true;
      log('SPACE',spaceId,'COMPLETE',{image_key_count:image.verified,space_deleted:db.deleted},startedAt);
      return {deleted:true,space_id:spaceId,image_deleted:true,image_key_count:image.verified,detached_template_count:detached.rowCount,db_deleted:true,steps:{image:image.verified,detached_templates:detached.rowCount,space:db.deleted}};
    }catch(e){
      log('SPACE',spaceId,'FAIL',{detail:String(e&&e.message||e),image_deleted:state.image_deleted,db_deleted:state.db_deleted},startedAt);
      throw wrapError(e,state);
    }
  }

  async function deleteTemplate(client,member,templateId){
    const startedAt=nowMs();
    const state={image_deleted:false,item_deleted_count:0,template_deleted:false,db_deleted:false};
    const ctx={kind:'TEMPLATE',id:templateId,startedAt,step:''};
    try{
      log('TEMPLATE',templateId,'START',{member_id:member},startedAt);
      const old=(await client.query('SELECT * FROM gm_smartfit_template WHERE template_id=$1 FOR UPDATE',[templateId])).rows[0];
      if(!old) throw new Error('template not found');
      if(!(await isOwnerOrAdmin(client,member,old.creator_member_id))) throw new Error('permission denied');
      if(String(old.is_deleted||'F').toUpperCase()!=='T') throw new Error('template must be in trash before permanent delete');
      const collectionLock=await getTemplateCollectionLock(client,templateId);
      if(collectionLock.collection_count>0) throw new Error('collected template cannot be deleted; change visibility to private');
      const itemRows=await lockTargetRows(client,'item',templateId,'item_id');
      log('TEMPLATE',templateId,'LOCK',{locked:true,item_count:itemRows.length,collection_count:collectionLock.collection_count},startedAt);

      const commentIds=await lockAndValidateComments(client,templateId,Object.assign({},ctx,{step:'PRECHECK_COMMENT'}));

      const keys=[];
      for(let imageNo=1;imageNo<=r2.RESERVED_IMAGES_PER_ID;imageNo++) keys.push(r2.keyFor('template',templateId,imageNo,'image'),r2.keyFor('template',templateId,imageNo,'small'));
      const image=await deleteR2KeysVerified(keys,Object.assign({},ctx,{step:'IMAGE'}));
      state.image_deleted=true;

      const item=await deleteAndVerify(client,'item',templateId,Object.assign({},ctx,{step:'ITEM'}));
      state.item_deleted_count=item.deleted;
      const delta=await deleteAndVerify(client,'delta',templateId,Object.assign({},ctx,{step:'DELTA'}));
      const receiver=await deleteAndVerify(client,'receiver',templateId,Object.assign({},ctx,{step:'MESSAGE_RECEIVER'}));
      const collection=await deleteAndVerify(client,'collection',templateId,Object.assign({},ctx,{step:'COLLECTION'}));
      const keyword=await deleteAndVerify(client,'keyword',templateId,Object.assign({},ctx,{step:'KEYWORD'}));
      const event=await deleteAndVerify(client,'event',templateId,Object.assign({},ctx,{step:'EVENT'}));
      const templateMedia=await deleteTemplateMedia(client,templateId,Object.assign({},ctx,{step:'TEMPLATE_MEDIA'}));
      const commentMedia=await deleteCommentMedia(client,commentIds,Object.assign({},ctx,{step:'COMMENT_MEDIA'}));
      const comment=await deleteAndVerify(client,'comment',templateId,Object.assign({},ctx,{step:'COMMENT'}));
      const queue=await deleteMessageQueue(client,templateId,Object.assign({},ctx,{step:'MESSAGE_QUEUE'}));
      const template=await deleteAndVerify(client,'template',templateId,Object.assign({},ctx,{step:'TEMPLATE_DB'}));
      state.template_deleted=true;
      state.db_deleted=true;

      const steps={image:image.verified,item:item.deleted,delta:delta.deleted,message_receiver:receiver.deleted,collection:collection.deleted,keyword:keyword.deleted,event:event.deleted,template_media:templateMedia.deleted,comment_media:commentMedia.deleted,comment:comment.deleted,message_queue:queue.deleted,template:template.deleted};
      log('TEMPLATE',templateId,'COMPLETE',{steps},startedAt);
      return {deleted:true,template_id:templateId,image_deleted:true,image_key_count:image.verified,item_deleted_count:item.deleted,delta_deleted_count:delta.deleted,message_receiver_deleted_count:receiver.deleted,collection_deleted_count:collection.deleted,keyword_deleted_count:keyword.deleted,event_deleted_count:event.deleted,template_media_deleted_count:templateMedia.deleted,comment_media_deleted_count:commentMedia.deleted,comment_deleted_count:comment.deleted,message_queue_deleted_count:queue.deleted,template_deleted:true,db_deleted:true,steps};
    }catch(e){
      log('TEMPLATE',templateId,'FAIL',{detail:String(e&&e.message||e),image_deleted:state.image_deleted,item_deleted_count:state.item_deleted_count,template_deleted:state.template_deleted,db_deleted:state.db_deleted},startedAt);
      throw wrapError(e,state);
    }
  }

  return {deleteSpace,deleteTemplate,deleteAndVerify,deleteR2KeysVerified};
};
