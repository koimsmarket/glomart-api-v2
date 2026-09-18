// GM_BUILDER_TABS_V001
(function(){
  const KEY='gm_builder_active_tab';
  function names(el){return String(el.getAttribute('data-builder-tab')||'').split(/\s+/).filter(Boolean);}
  window.openBuilderTab=function(name){
    const tab=String(name||'status');
    document.querySelectorAll('[data-builder-tab]').forEach(el=>{el.style.display=names(el).includes(tab)?'':'none';});
    document.querySelectorAll('.builder-tab-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===tab));
    try{localStorage.setItem(KEY,tab);}catch(_){ }
    window.scrollTo({top:0,behavior:'smooth'});
  };
  window.addEventListener('DOMContentLoaded',()=>{
    let tab='status'; try{tab=localStorage.getItem(KEY)||tab;}catch(_){ }
    if(![...document.querySelectorAll('.builder-tab-btn')].some(b=>b.dataset.tab===tab))tab='status';
    openBuilderTab(tab);
  });
})();
