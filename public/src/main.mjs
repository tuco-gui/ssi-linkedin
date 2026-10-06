import { parseLinkedinZip } from './parser.mjs';
import { analyze } from './scoring.mjs';

const $ = (id) => document.getElementById(id);
const HISTORY_KEY = 'ssi-lab-personal-history-v2';
let lastResult = null;

const fieldSpecs = [
  ['profile_photo','Foto profissional?','bool'], ['cover_photo','Banner/capa?','bool'], ['featured_items','Itens em Destaques'],
  ['recommendations_count','Recomendações recebidas'], ['follower_growth_30d','Novos seguidores em 30 dias'],
  ['people_searches_30d','Buscas de pessoas em 30 dias'], ['prospect_profile_views_30d','Perfis de prospects visualizados em 30 dias'],
  ['inbound_profile_views_30d','Visualizações recebidas no perfil (30d)'], ['saved_leads_30d','Prospects salvos em 30 dias'],
  ['active_days_30d','Dias ativos no LinkedIn em 30 dias'], ['target_network_quality_0_10','Qualidade da rede-alvo (0–10)'],
  ['engagements_given_30d','Comentários + reações feitos em 30 dias'], ['engagements_received_30d','Engajamentos recebidos em 30 dias'],
  ['avg_post_engagement_rate','Taxa média de engajamento dos posts (%)'], ['messages_sent_30d','Mensagens enviadas em 30 dias'],
  ['message_response_rate','Taxa de resposta às mensagens (%)'], ['relevant_groups_count','Grupos relevantes'],
  ['acceptance_rate','Taxa de aceitação de convites (%)'], ['senior_connections_quality_0_10','Qualidade da rede de decisores (0–10)'],
  ['icp_connections_quality_0_10','Conexões dentro do ICP (0–10)'], ['recurring_relationships_quality_0_10','Relacionamentos recorrentes (0–10)'],
  ['business_leads_30d','Leads gerados em 30 dias'], ['qualified_conversations_30d','Conversas qualificadas em 30 dias'],
  ['meetings_30d','Reuniões originadas em 30 dias'], ['opportunities_30d','Oportunidades comerciais em 30 dias']
];

for (const [id,label,type] of fieldSpecs) {
  const wrap = document.createElement('div'); wrap.className = 'field';
  const lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = label; wrap.append(lab);
  let input;
  if (type === 'bool') {
    input = document.createElement('select');
    [['','Não informado'],['true','Sim'],['false','Não']].forEach(([v,t]) => input.add(new Option(t,v)));
  } else {
    input = document.createElement('input'); input.type = 'number'; input.step = '0.1'; input.min = '0';
    if (id.endsWith('_0_10')) input.max = '10';
    if (/rate|acceptance/.test(id)) input.max = '100';
  }
  input.id = id; wrap.append(input); $('fields').append(wrap);
}

function readManual() {
  const out = {};
  for (const [id,,type] of fieldSpecs) {
    const value = $(id).value;
    if (value === '') continue;
    out[id] = type === 'bool' ? value === 'true' : Number(value);
  }
  return out;
}

function setStatus(message, error=false) {
  $('status').textContent = message;
  $('status').className = 'inline-status' + (error ? ' error' : '');
}

$('zip').addEventListener('change', () => {
  const file = $('zip').files[0];
  $('filename').textContent = file?.name || 'Clique aqui para selecionar seu ZIP';
  $('fileStatus').textContent = file ? 'Arquivo selecionado. Clique em calcular.' : 'Nenhum arquivo selecionado.';
});

for (const evt of ['dragover','dragleave','drop']) {
  $('dropzone').addEventListener(evt, (e) => e.preventDefault());
}
$('dropzone').addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const dt = new DataTransfer(); dt.items.add(file); $('zip').files = dt.files; $('zip').dispatchEvent(new Event('change'));
});

function renderBars(id, items, max) {
  const root = $(id); root.replaceChildren();
  Object.values(items).forEach((item) => {
    const row = document.createElement('div'); row.className = 'metric';
    const content = document.createElement('div'); content.className = 'metric-content';
    const label = document.createElement('div'); label.className = 'metric-label'; label.textContent = item.label;
    const track = document.createElement('div'); track.className = 'track';
    const fill = document.createElement('div'); fill.style.width = `${Math.min(100, item.score / max * 100)}%`; track.append(fill);
    const note = document.createElement('div'); note.className = 'metric-note'; note.textContent = `Confiança: ${item.confidence}%`;
    content.append(label,track,note);
    const points = document.createElement('div'); points.className = 'metric-points'; points.textContent = `${item.score}/${max}`;
    row.append(content,points); root.append(row);
  });
}

function renderPriorities(result) {
  const p = Object.values(result.ssi_estimated.pillars).map(x => ({label:x.label, ratio:x.score/25, confidence:x.confidence}));
  const d = Object.values(result.ssi_figueira.dimensions).map(x => ({label:x.label, ratio:x.score/20, confidence:x.confidence}));
  const list = [...p,...d].filter(x => x.confidence >= 25).sort((a,b) => a.ratio-b.ratio).slice(0,5);
  $('priorities').replaceChildren();
  if (!list.length) list.push({label:'Complete as métricas complementares',ratio:0,confidence:0});
  list.forEach(x => { const li=document.createElement('li'); li.textContent=`${x.label}: ${Math.round(x.ratio*100)}% do máximo. Confiança ${x.confidence}%.`; $('priorities').append(li); });
}

function renderResult(result) {
  $('ssiScore').textContent = result.ssi_estimated.score;
  $('figScore').textContent = result.ssi_figueira.score;
  $('ssiConf').textContent = `Confiança ${result.ssi_estimated.confidence}%`;
  $('figConf').textContent = `Confiança ${result.ssi_figueira.confidence}%`;
  renderBars('pillars', result.ssi_estimated.pillars, 25);
  renderBars('dimensions', result.ssi_figueira.dimensions, 20);
  renderPriorities(result);
  $('files').textContent = result.files_detected.map(x=>x.split('/').at(-1)).join(' · ');
  $('result').hidden = false;
}

$('analyze').addEventListener('click', async () => {
  const file = $('zip').files[0];
  if (!file) return setStatus('Selecione o ZIP do LinkedIn primeiro.', true);
  $('analyze').disabled = true; setStatus('Lendo o ZIP e calculando no navegador…');
  try {
    const exported = await parseLinkedinZip(file);
    lastResult = analyze(exported, readManual());
    renderResult(lastResult); setStatus('Análise concluída.');
    $('result').scrollIntoView({behavior:'smooth',block:'start'});
  } catch (e) { setStatus(e.message || String(e), true); }
  finally { $('analyze').disabled = false; }
});

function history() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
function writeHistory(rows) { localStorage.setItem(HISTORY_KEY, JSON.stringify(rows)); renderHistory(); }
function saveJson(obj,name) { const b=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }

$('download').addEventListener('click', () => { if (lastResult) saveJson(lastResult, `ssi-analise-${new Date().toISOString().slice(0,10)}.json`); });
$('save').addEventListener('click', () => {
  if (!lastResult) return;
  const rows=history(); const label=$('label').value.trim() || `Medição ${rows.length+1}`;
  rows.push({id:Date.now(),label,generated_at:lastResult.generated_at,engine_version:lastResult.engine_version,ssi_estimated:lastResult.ssi_estimated.score,ssi_confidence:lastResult.ssi_estimated.confidence,ssi_figueira:lastResult.ssi_figueira.score,figueira_confidence:lastResult.ssi_figueira.confidence});
  writeHistory(rows); $('saveStatus').textContent='Medição salva neste navegador.';
});
$('backup').addEventListener('click', () => saveJson({app:'ssi-lab-personal',schema:2,rows:history()},`ssi-historico-${new Date().toISOString().slice(0,10)}.json`));
$('clear').addEventListener('click', () => { if (confirm('Apagar o histórico salvo neste navegador?')) { localStorage.removeItem(HISTORY_KEY); renderHistory(); } });
$('restore').addEventListener('change', async () => {
  const f=$('restore').files[0]; if(!f) return;
  try { const data=JSON.parse(await f.text()); if(data.app!=='ssi-lab-personal'||data.schema!==2||!Array.isArray(data.rows)) throw new Error('Arquivo incompatível'); writeHistory([...history(),...data.rows]); alert('Histórico importado.'); } catch(e) { alert(`Não foi possível importar: ${e.message}`); }
});

function renderHistory() {
  const rows=history(), root=$('history'); root.replaceChildren();
  if(!rows.length){root.className='history-placeholder';root.textContent='Seu primeiro baseline aparecerá aqui.';return;}
  root.className='table-wrap'; const table=document.createElement('table');
  table.innerHTML='<thead><tr><th>Medição</th><th>Data</th><th>SSI estimado</th><th>Score próprio</th><th>Régua</th></tr></thead>';
  const body=document.createElement('tbody'); rows.forEach(r=>{const tr=document.createElement('tr'); [r.label,(r.generated_at||'').slice(0,10),`${r.ssi_estimated} (${r.ssi_confidence}%)`,`${r.ssi_figueira} (${r.figueira_confidence}%)`,r.engine_version].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});body.append(tr)}); table.append(body); root.append(table);
}
renderHistory();
