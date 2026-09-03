(function(){
  const slides=[...document.querySelectorAll('.slide')]; let current=0;
  const counter=document.querySelector('#counter'), bar=document.querySelector('.progress i');
  function show(n){current=(n+slides.length)%slides.length;slides.forEach((s,i)=>s.classList.toggle('active',i===current));counter.textContent=`${current+1} / ${slides.length}`;bar.style.width=`${((current+1)/slides.length)*100}%`;history.replaceState(null,'',`#slide-${current+1}`);}
  function go(delta){show(current+delta)}
  document.querySelector('#prev').addEventListener('click',()=>go(-1)); document.querySelector('#next').addEventListener('click',()=>go(1));
  document.querySelector('#notes-toggle').addEventListener('click',e=>{document.body.classList.toggle('show-notes');e.currentTarget.setAttribute('aria-pressed',document.body.classList.contains('show-notes'));});
  document.querySelector('#print').addEventListener('click',()=>window.print());
  document.addEventListener('keydown',e=>{if(['ArrowRight','ArrowDown',' ','PageDown'].includes(e.key)){e.preventDefault();go(1)}else if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();go(-1)}else if(e.key==='Home'){e.preventDefault();show(0)}else if(e.key==='End'){e.preventDefault();show(slides.length-1)}});
  window.addEventListener('hashchange',()=>{const n=Number(location.hash.replace('#slide-',''));if(n>=1&&n<=slides.length)show(n-1)});
  const n=Number(location.hash.replace('#slide-',''));show(n>=1&&n<=slides.length?n-1:0);
})();
