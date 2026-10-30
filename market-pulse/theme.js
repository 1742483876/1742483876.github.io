'use strict';
(function(){
  const palettes={
    light:{background:'#f6f7f9',panel:'#ffffff',text:'#172b46',muted:'#586a80',line:'#dce2ea',accent:'#205493',up:'#cf4453',down:'#16876c',ma:'#8862bd',volume:'#8094ad',crosshair:'#64748b',buy:'#205493',sell:'#b78120'},
    dark:{background:'#091524',panel:'#101f33',text:'#e9f1fb',muted:'#9aabc2',line:'#293e58',accent:'#63a5ff',up:'#f18b96',down:'#56c6a7',ma:'#c5a6eb',volume:'#8094ad',crosshair:'#b4c4d8',buy:'#63a5ff',sell:'#e8b85a'}
  };
  function normalize(value){return value==='dark'?'dark':'light';}
  if(typeof module!=='undefined'&&module.exports)module.exports={normalize,palettes};
  if(typeof document==='undefined')return;
  let theme='light';try{theme=normalize(localStorage.getItem('pulse-mobile-theme'));}catch(_){}
  function apply(value,save=false){theme=normalize(value);document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',palettes[theme].background);if(save)try{localStorage.setItem('pulse-mobile-theme',theme);}catch(_){}const button=document.getElementById('themeToggle');if(button){button.textContent=theme==='light'?'☾ 夜间':'☀ 浅色';button.setAttribute('aria-label',theme==='light'?'切换到夜间配色':'切换到浅色配色');button.setAttribute('aria-pressed',String(theme==='dark'));}window.dispatchEvent(new CustomEvent('pulse:theme',{detail:{theme,palette:palettes[theme]}}));}
  window.PulseTheme={palette:()=>({...palettes[theme]}),get:()=>theme,set:value=>apply(value,true)};
  apply(theme);
  document.addEventListener('DOMContentLoaded',()=>{const top=document.querySelector('.top');if(!top)return;const controls=document.createElement('div');controls.className='top-controls';const badge=top.querySelector('.snapshot-badge');if(badge)controls.append(badge);const button=document.createElement('button');button.id='themeToggle';button.type='button';button.className='theme-toggle';button.addEventListener('click',()=>apply(theme==='light'?'dark':'light',true));controls.append(button);top.append(controls);apply(theme);});
}());
