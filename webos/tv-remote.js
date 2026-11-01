// LG webOS kumandası: oklarla odak, OK ile seçim, Geri ile kapatma.
(function () {
  const selector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"], [tabindex]:not([tabindex="-1"])';
  function candidates() { return Array.from(document.querySelectorAll(selector)).filter(el => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; }); }
  function move(direction) {
    const all=candidates(); if (!all.length) return;
    const active=document.activeElement; if (!all.includes(active)) { all[0].focus(); return; }
    const a=active.getBoundingClientRect(); const ax=a.left+a.width/2, ay=a.top+a.height/2;
    let best=null, score=Infinity;
    for(const el of all){ if(el===active) continue; const b=el.getBoundingClientRect(); const dx=b.left+b.width/2-ax,dy=b.top+b.height/2-ay;
      const primary=direction==='left'?-dx:direction==='right'?dx:direction==='up'?-dy:dy;
      if(primary<=4) continue;
      const cross=direction==='left'||direction==='right'?Math.abs(dy):Math.abs(dx);
      const rank=primary+cross*2.4; if(rank<score){score=rank;best=el;}
    }
    if(best){best.focus();best.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});}
  }
  document.addEventListener('keydown',e=>{
    const key=e.keyCode; const tag=document.activeElement?.tagName;
    if((key===37||key===38||key===39||key===40) && !['INPUT','TEXTAREA','SELECT'].includes(tag)){
      e.preventDefault();move(({37:'left',38:'up',39:'right',40:'down'})[key]);
    }else if(key===461||key===27){
      const close=[...document.querySelectorAll('button')].filter(el=>/kapat|geri|close|iptal/i.test(el.textContent||'') && el.getBoundingClientRect().width>0).pop();
      if(close){e.preventDefault();close.click();} // Çıkış için app'e bırak; otomatik uygulamayı kapatma.
    }else if(key===13 && document.activeElement && document.activeElement.tagName!=='INPUT'){
      const a=document.activeElement;if(a instanceof HTMLElement && a.matches('button,[role="button"]')){e.preventDefault();a.click();}
    }
  });
})();
