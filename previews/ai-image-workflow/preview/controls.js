/* Local UI preview only: no request is submitted, no images are generated/uploaded. */
const generationDraft = new Map();
const imageDraft = new Map();
const currentImageKeys = new Set();
const baselineId = 'synthetic-design-fixture-v1';
const panel = document.createElement('section');
panel.className = 'control-preview-banner';
panel.innerHTML = `<strong>两项选择 · 交互预览，尚未接通</strong><p>这里的勾选只形成当前页面的草稿，不会出图、批准、上传或发布。刷新后清空。正式版需 Kevin 身份验证与后台回执。</p><p>目标：合成演示目录。未连接任何真实网站。</p><div class="preview-toolbar"><span id="draft-count" role="status" aria-live="polite"></span><button type="button" id="export-draft">导出选择草稿</button><button type="button" id="clear-draft">清空本页选择</button></div><p id="draft-notice" role="status">未提交 · 出图执行器、审批存储、上传入口待接通</p>`;
document.querySelector('header').after(panel);
function updateDraftCount(){
  document.getElementById('draft-count').textContent = `待出图 ${generationDraft.size} 款 · 待逐图确认 ${imageDraft.size} 张`;
}
function mountControls(){
  currentImageKeys.clear();
  for (const product of PRODUCTS) {
    for (const image of aiImagesFor(product)) {
      try {currentImageKeys.add(keyFor(imageIdentity(product,{...image,version:image.version || AI_GALLERY[product.sku]?.version})));} catch {}
    }
  }
  for (const key of imageDraft.keys()) if (!currentImageKeys.has(key)) imageDraft.delete(key);
  for (const row of document.querySelectorAll('article[data-sku]')) {
    const product=PRODUCTS.find(p=>p.sku===row.dataset.sku);
    const group=document.createElement('div'); group.className='intent-box';
    const generation=document.createElement('input'); generation.type='checkbox';
    generation.id=`generate-${product.sku}`; generation.dataset.action='generate'; generation.dataset.sku=product.sku;
    generation.checked=generationDraft.has(product.sku);
    generation.disabled=!product.code || !unchangedIdentity(product) || IDENTITY_HOLDS.has(product.sku) || imagesFor(product).length===0;
    const label=document.createElement('label'); label.htmlFor=generation.id; label.append(generation,document.createTextNode(' ① 选择生成 AI 图'));
    const help=document.createElement('small'); help.textContent=generation.disabled?'产品身份或原图待核，暂不可选择':'目标为原出图流程；演示勾选仍未提交。';
    const trigger=document.createElement('button'); trigger.type='button'; trigger.disabled=true; trigger.textContent='出图入口待接通';
    group.append(label,help,trigger); row.querySelector('.body').append(group);
    const ai=aiImagesFor(product);
    row.querySelectorAll('.ai-gallery figure').forEach((figure,i)=>{
      const box=document.createElement('div'); box.className='intent-box';
      try {
        const identity=imageIdentity(product,{...ai[i],version:ai[i].version||AI_GALLERY[product.sku]?.version});
        const key=keyFor(identity); const cb=document.createElement('input'); cb.type='checkbox'; cb.id=`approve-${product.sku}-${i}`;
        cb.dataset.action='select-image'; cb.dataset.identity=JSON.stringify(identity); cb.checked=imageDraft.has(key);
        const label=document.createElement('label');label.htmlFor=cb.id;label.append(cb,document.createTextNode(' ② 选择此图，待确认上传产品册'));
        const small=document.createElement('small');small.textContent=`${identity.sku} · ${identity.version} · SHA256 ${identity.outputSha256.slice(0,12)}…`;
        small.title=`文件：${identity.imageUrl}\n完整 SHA256：${identity.outputSha256}`;
        const status=document.createElement('small');status.textContent='未批准 · 未提交上传';
        box.append(label,small,status);
      } catch {box.textContent='文件身份／版本缺失，不能选择上传';}
      figure.append(box);
    });
  }
  updateDraftCount();
}
document.addEventListener('change',event=>{
  const el=event.target;
  if (el.dataset.action==='generate'){
    const p=PRODUCTS.find(p=>p.sku===el.dataset.sku);
    if(el.checked) generationDraft.set(p.sku,{sku:p.sku,productCode:p.code,sourceWorkflow:'original-generation-conversation',state:'unsubmitted'});
    else generationDraft.delete(p.sku);
  } else if(el.dataset.action==='select-image'){
    const identity=JSON.parse(el.dataset.identity), key=keyFor(identity);
    if(el.checked && currentImageKeys.has(key)) imageDraft.set(key,identity); else imageDraft.delete(key);
  }
  updateDraftCount();
});
document.getElementById('clear-draft').addEventListener('click',()=>{
  generationDraft.clear();imageDraft.clear();render();
  document.getElementById('draft-notice').textContent='本页草稿已清空。没有撤回服务器任务，也没有删除图片。';
});
document.getElementById('export-draft').addEventListener('click',()=>{
  try {
    const draft=createDraft([...generationDraft.values()],[...imageDraft.values()],baselineId,currentImageKeys);
    const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='terrella-unsubmitted-selection-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    document.getElementById('draft-notice').textContent='已导出选择草稿。未提交请求、未批准图片、未触发上传。';
  } catch {document.getElementById('draft-notice').textContent='图片版本已变化，请重新选择。没有提交任何请求。';}
});
const renderWithoutControls=render;
render=function(){renderWithoutControls();mountControls();};
render();
