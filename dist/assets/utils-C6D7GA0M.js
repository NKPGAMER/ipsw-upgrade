import{t as $}from"./index-yN8as9Xb.js";function x(i){const t=document.querySelectorAll(".error-message, .success-message"),e=i.offsetHeight+10;t.forEach(s=>{if(s!==i){const o=parseInt(s.style.top||"20");s.style.transition="top 0.3s ease",s.style.top=o+e+"px"}})}function k(){const i=document.querySelectorAll(".error-message, .success-message");let t=20;i.forEach(e=>{const s=e;parseInt(s.style.top||"20")!==t&&(s.style.transition="top 0.3s ease",s.style.top=t+"px"),t+=s.offsetHeight+10})}class C{queue=[];active=!1;root;constructor(){let t=document.getElementById("confirm-root");t||(t=document.createElement("div"),t.id="confirm-root",document.body.appendChild(t)),this.root=t}confirm(t,e={}){return new Promise(s=>{this.queue.push({message:t,options:e,resolve:s}),this.active||this.next()})}closeAll(){return new Promise((t,e)=>{try{for(const o of this.queue)o.resolve(!1);this.queue=[],this.active=!1;const s=this.root.querySelector(".confirm-wrap");if(s){const o=s.querySelector(".confirm-backdrop"),c=s.querySelector(".confirm-dialog");o?.classList.replace("backdrop-in","backdrop-out"),c?.classList.replace("dialog-in","dialog-out"),setTimeout(()=>{s.remove()},180)}else this.active=!1;t(!0)}catch{e(!1)}})}next(){const t=this.queue.shift();if(!t){this.active=!1;return}this.active=!0,this.show(t)}show(t){const{title:e="",confirmText:s="Ok",cancelText:o="Cancel",variant:c="default"}=t.options,n=document.createElement("div");n.className="confirm-wrap",n.innerHTML=`
      <div class="confirm-backdrop backdrop-in"></div>

      <div class="confirm-dialog dialog-in confirm-${c}" tabindex="0">

        <div class="confirm-accent"></div>

        <div class="confirm-body">

          <div class="confirm-header">

            <div class="confirm-icon">
              ${this.icon(c)}
            </div>

            <div>
              ${e?`<div class="confirm-title">${e}</div>`:""}
              <div class="confirm-content">
                ${this.renderMarkdown(t.message)}
              </div>
            </div>

          </div>

          <div class="confirm-divider"></div>

          <div class="confirm-actions">
            <button class="confirm-btn confirm-btn-cancel">
              ${o}
            </button>

            <button class="confirm-btn confirm-btn-confirm">
              ${s}
            </button>
          </div>

        </div>
      </div>
    `,this.root.appendChild(n);const p=n.querySelector(".confirm-backdrop"),u=n.querySelector(".confirm-dialog"),l=n.querySelector(".confirm-btn-cancel"),r=n.querySelector(".confirm-btn-confirm");u.focus();const a=d=>{p.classList.replace("backdrop-in","backdrop-out"),u.classList.replace("dialog-in","dialog-out"),setTimeout(()=>{n.remove(),t.resolve(d),this.next()},180)};r.onclick=()=>a(!0),l.onclick=()=>a(!1),p.onclick=()=>a(!1),n.addEventListener("keydown",d=>{d.key==="Escape"&&a(!1),d.key==="Enter"&&a(!0)})}icon(t){const e={default:`
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
      `,danger:`
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
        <path d="M12 9v4m0 4h.01"/>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      </svg>
      `,warning:`
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4m0 4h.01"/>
      </svg>
      `,info:`
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4m0-4h.01"/>
      </svg>
      `};return e[t]||e.default}css=`
  .md-body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 15px; line-height: 1.7; color: #cdd6f4;}
  .md-h1 { font-size: 1.75em; font-weight: 700; color: #cba6f7; margin: 1.2em 0 0.5em; border-bottom: 2px solid #313244; padding-bottom: 0.3em; }
  .md-h2 { font-size: 1.4em; font-weight: 600; color: #89b4fa; margin: 1em 0 0.4em; border-bottom: 1px solid #313244; padding-bottom: 0.2em; }
  .md-h3 { font-size: 1.15em; font-weight: 600; color: #94e2d5; margin: 0.9em 0 0.3em; }
  .md-hr { border: none; border-top: 1px solid #313244; margin: 1.2em 0; }
  .md-ul { list-style: none; padding: 0; margin: 0.5em 0; }
  .md-ol { padding-left: 1.5em; margin: 0.5em 0; color: #cdd6f4; }
  .md-li { display: flex; align-items: flex-start; gap: 0.5em; padding: 0.2em 0; }
  .md-li-bullet { color: #cba6f7; font-size: 0.85em; margin-top: 0.3em; flex-shrink: 0; }
  .md-ol-li { padding: 0.2em 0; }
  .md-blockquote { border-left: 4px solid #cba6f7; background: #181825; margin: 0.8em 0; padding: 0.6em 1em; border-radius: 0 6px 6px 0; color: #a6adc8; font-style: italic; }
  .md-code-block { background: #11111b; color: #cdd6f4; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 0.88em; padding: 1em 1.2em; border-radius: 8px; margin: 0.8em 0; overflow-x: auto; white-space: pre; border: 1px solid #313244; }
  .md-code-lang { font-size: 0.75em; color: #89b4fa; margin-bottom: 0.5em; text-transform: uppercase; letter-spacing: 0.05em; }
  .md-p { margin: 0.5em 0; color: #cdd6f4; }
  .md-gap { height: 6px; }
  .md-table { width: 100%; border-collapse: collapse; margin: 0.8em 0; font-size: 0.92em; }
  .md-table th { background: #181825; font-weight: 600; text-align: left; padding: 0.5em 0.9em; border: 1px solid #313244; color: #89b4fa; }
  .md-table td { padding: 0.45em 0.9em; border: 1px solid #313244; color: #cdd6f4; }
  .md-table tr:nth-child(even) td { background: #181825; }
  .md-img { max-width: 100%; border-radius: 6px; margin: 0.5em 0; display: block; }
  code { background: #313244; color: #f38ba8; font-family: 'Cascadia Code', monospace; font-size: 0.88em; padding: 0.1em 0.4em; border-radius: 4px; }
  strong { font-weight: 700; color: #f9e2af; }
  em { font-style: italic; color: #a6e3a1; }
  a { color: #89b4fa; text-decoration: underline; text-underline-offset: 2px; }
  a:hover { color: #b4d0fa; }
  del { color: #585b70; text-decoration: line-through; }
  mark { background: #f9e2af22; color: #f9e2af; padding: 0 0.2em; border-radius: 2px; border: 1px solid #f9e2af44; }
`;inline(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img class="md-img" src="$2" alt="$1">').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*\*(.+?)\*\*\*/g,"<strong><em>$1</em></strong>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>").replace(/~~(.+?)~~/g,"<del>$1</del>").replace(/==(.+?)==/g,"<mark>$1</mark>").replace(/_([\w\s]+)_/g,"<em>$1</em>")}renderMarkdown(t){const e=t.split(`
`),s=[];let o=0,c=[],n=[];const p=()=>{n.length&&(s.push(`<ul class="md-ul">${n.join("")}</ul>`),n=[])},u=()=>{c.length&&(s.push(`<ol class="md-ol">${c.join("")}</ol>`),c=[])},l=()=>{p(),u()};for(;o<e.length;){const r=e[o],a=r.match(/^```(\w*)/);if(a){l();const h=a[1],f=[];for(o++;o<e.length&&!e[o].startsWith("```");)f.push(e[o].replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")),o++;const m=h?`<div class="md-code-lang">${h}</div>`:"";s.push(`<div class="md-code-block">${m}${f.join(`
`)}</div>`),o++;continue}const d=r.match(/^(#{1,3})\s+(.+)/);if(d){l();const h=d[1].length;s.push(`<div class="md-h${h}">${this.inline(d[2])}</div>`),o++;continue}if(/^(-{3,}|\*{3,}|_{3,})$/.test(r.trim())){l(),s.push('<hr class="md-hr">'),o++;continue}const b=r.match(/^>\s*(.*)/);if(b){l(),s.push(`<div class="md-blockquote">${this.inline(b[1])}</div>`),o++;continue}if(r.includes("|")&&e[o+1]?.match(/^\|?[\s\-|:]+\|?$/)){l();const f=[`<table class="md-table"><thead><tr>${r.split("|").map(m=>m.trim()).filter(Boolean).map(m=>`<th>${this.inline(m)}</th>`).join("")}</tr></thead><tbody>`];for(o+=2;o<e.length&&e[o].includes("|");){const m=e[o].split("|").map(g=>g.trim()).filter(Boolean);f.push(`<tr>${m.map(g=>`<td>${this.inline(g)}</td>`).join("")}</tr>`),o++}f.push("</tbody></table>"),s.push(f.join(""));continue}const v=r.match(/^[-*+]\s+(.+)/);if(v){u(),n.push(`<li class="md-li"><span class="md-li-bullet">▶</span><span>${this.inline(v[1])}</span></li>`),o++;continue}const y=r.match(/^\d+\.\s+(.+)/);if(y){p(),c.push(`<li class="md-ol-li">${this.inline(y[1])}</li>`),o++;continue}if(!r.trim()){l(),s.push('<div class="md-gap"></div>'),o++;continue}l(),s.push(`<p class="md-p">${this.inline(r)}</p>`),o++}return l(),`<style>${this.css}</style><div class="md-body">${s.join("")}</div>`}}const w=new C,B={sleep:i=>new Promise(t=>setTimeout(t,i)),showErrorMessage(i,t=8e3){const e=document.createElement("div");e.className="message error-message",e.textContent=i,e.style.top="20px",document.body.appendChild(e),x(e),setTimeout(()=>{e.style.transition="transform 0.3s ease, opacity 0.3s ease",e.style.transform="translateX(400px)",e.style.opacity="0",setTimeout(()=>{e.remove(),k()},300)},t)},showSuccessMessage(i,t=4e3){const e=document.createElement("div");e.className="message success-message",e.textContent=typeof i=="string"?i:$(i.id),e.style.top="20px",document.body.appendChild(e),x(e),setTimeout(()=>{e.style.transition="transform 0.3s ease, opacity 0.3s ease",e.style.transform="translateX(400px)",e.style.opacity="0",setTimeout(()=>{e.remove(),k()},300)},t)},formatBytes(i,t=2){if(i===0)return{value:"0",unit:"Bytes"};const e=1024,s=["Bytes","KB","MB","GB","TB","PB"],o=Math.floor(Math.log(i)/Math.log(e));return{value:parseFloat((i/Math.pow(e,o)).toFixed(t)).toString(),unit:s[o]}},customConfirm:(i,t)=>w.confirm(i,t),closeAllConfirm:async()=>await w.closeAll()};export{B as u};
