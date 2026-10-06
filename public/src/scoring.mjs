export const VERSION = '0.3.0';
const r1 = x => Math.round((x + Number.EPSILON) * 10) / 10;
const clamp = (v,lo=0,hi=1) => Math.max(lo,Math.min(hi,v));
const band = (n,pairs) => {let value=0;for(const [bound,score] of pairs)if(n>=bound)value=score;return clamp(value);};
const signal = (name, weight, value, evidence='') => ({name,weight,value,evidence});
const numeric = (obj,key) => obj[key]===undefined||obj[key]===null||obj[key]===''?null:Number.isFinite(Number(obj[key]))?Math.max(0,Number(obj[key])):null;
const boolean = (obj,key) => obj[key]===true?1:obj[key]===false?0:null;
function aggregate(signals, maxPoints=25) {
  const weighted = signals.filter(s=>s.value!==null&&s.value!==undefined);
  const observed = weighted.reduce((a,s)=>a+s.weight,0);
  const total = signals.reduce((a,s)=>a+s.weight,0);
  const weightedScore = observed ? weighted.reduce((a,s)=>a+s.weight*clamp(s.value),0)/observed : 0;
  return {score:r1(weightedScore*maxPoints), confidence:r1(total?observed/total*100:0),signals:signals.map(s=>({name:s.name,weight:s.weight,available:s.value!==null&&s.value!==undefined,score_pct:s.value==null?null:r1(clamp(s.value)*100),evidence:s.evidence}))};
}
const first = (row,...keys) => {const obj=Object.fromEntries(Object.entries(row||{}).map(([k,v])=>[k.toLowerCase(),String(v??'')]));for(const k of keys)if(obj[k.toLowerCase()]?.trim())return obj[k.toLowerCase()].trim();return '';};
function dateValue(s) {
 if (!s) return null;
 const v=String(s).trim();
 if (/^\d{4}-\d\d-\d\d/.test(v)) {const d=new Date(v.slice(0,10)+'T00:00:00Z');return Number.isNaN(+d)?null:d;}
 const m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m){const d=new Date(Date.UTC(+m[3],+m[1]-1,+m[2]));return Number.isNaN(+d)?null:d;}
 const year=v.match(/(?:19|20)\d{2}/); if(year) return new Date(Date.UTC(+year[0],0,1));
 return null;
}
function recent(rows,now,days=30) {let count=0;const cutoff=+now-days*86400000;for(const row of rows){for(const [key,value] of Object.entries(row)){if(!/(date|time|created)/i.test(key))continue;const d=dateValue(value);if(d){if(+d>=cutoff&&+d<=+now)count++;break;}}}return count;}
function getInputs(exp,now) {
  const profile=exp.findRows('profile')[0]??{};
  const positions=exp.findRows('position','experience');const skills=exp.findRows('skill');const connections=exp.findRows('connection');
  const posts=exp.findRows('share','post'); const education=exp.findRows('education');const certs=exp.findRows('certification','license');
  const emails=exp.findRows('email address'); const languages=exp.findRows('language');
  const follows=exp.findRows('company follow');const peopleFollows=exp.findRows('member_follow','member follow');
  return {headline:first(profile,'Headline','Title'),about:first(profile,'Summary','About'),location:first(profile,'Geo Location','Location'),industry:first(profile,'Industry'),name:[first(profile,'First Name'),first(profile,'Last Name')].filter(Boolean).join(' ')||first(profile,'Name'),positions,experience_descriptions:positions.map(r=>first(r,'Description')),experience_titles:positions.map(r=>first(r,'Title','Position')),skills_count:skills.length,connections_count:connections.length,posts_count:posts.length,posts_30d:recent(posts,now),education_count:education.length,certifications_count:certs.length,emails_count:emails.length,languages_count:languages.length,interests_count:follows.length+peopleFollows.length};
}
export function profileScore(exp,now=new Date()) {
 const x=getInputs(exp,now), sections=[];
 const add=(name,weight,value,evidence)=>sections.push({name,weight,score:r1(clamp(value)*10),value:clamp(value),evidence});
 const h=x.headline;
 let headlineScore = h ? .45 : .1;
 if(h){if(h.length>=35&&h.length<=180)headlineScore+=.2;if(/[|•/]/.test(h))headlineScore+=.1;if(x.industry&&h.toLowerCase().includes(x.industry.toLowerCase()))headlineScore+=.1;if(!/[🔥🚀💡❤️✅]/u.test(h))headlineScore+=.1;}
 add('Headline',15,headlineScore,h||'ausente');
 add('Skills',13,band(x.skills_count,[[0,.05],[5,.35],[10,.7],[15,.9],[25,1]]),`${x.skills_count} competências`);
 const desc=x.experience_descriptions.filter(Boolean); let descriptionScore=.1;
 if(x.positions.length){const coverage=desc.length/x.positions.length, metrics=desc.filter(t=>/\d/.test(t)).length/Math.max(1,desc.length),format=desc.filter(t=>t.includes('\n')||t.includes('•')||t.slice(0,6).includes('-')).length/Math.max(1,desc.length);descriptionScore=.15+.45*coverage+.25*metrics+.15*format;}
 add('Experiências descritas',12,descriptionScore,`${desc.length}/${x.positions.length} descrições`);
 const a=x.about;const words=a.trim()?a.trim().split(/\s+/).length:0;const ab=!a?.05:.35+(words>=80&&words<=350?.35:.15)+(a.includes('\n')?.15:0)+(/contato|connect|fale|mensagem|conversar/i.test(a)?.15:0);
 add('Sobre',10,ab,`${words} palavras`);
 const titles=x.experience_titles.filter(Boolean);add('Cargos',8,titles.length? .55 + .05*Math.min(6,titles.length):.15,`${titles.length} cargos`);
 add('Conexões',8,band(x.connections_count,[[0,.05],[50,.25],[150,.5],[300,.75],[500,1]]),`${x.connections_count} conexões`);
 const dated=x.positions.filter(p=>Object.entries(p).some(([k,v])=>k.toLowerCase().includes('start')&&v)).length;
 add('Duração das experiências',5,x.positions.length?.35+.65*dated/x.positions.length:.2,`${dated}/${x.positions.length} datas`);
 add('Atividade',5,band(x.posts_30d,[[0,.1],[1,.35],[2,.55],[4,.8],[8,1]]),`${x.posts_30d} publicações/30d`);
 add('Interesses',4,band(x.interests_count,[[0,.2],[5,.45],[10,.7],[20,1]]),`${x.interests_count} interesses`);
 add('Idiomas',4,x.languages_count?.8:.5,`${x.languages_count} idiomas`);
 add('Localização',4,x.location?1:.15,x.location||'ausente');
 add('Contato',4,x.emails_count?1:.35,`${x.emails_count} emails`);
 add('Certificações',3,x.certifications_count?(x.certifications_count<=6?.95:.75):.6,`${x.certifications_count} certificações`);
 add('Educação',3,x.education_count?.85:.45,`${x.education_count} formações`);
 const nw=x.name.trim().split(/\s+/).filter(Boolean).length;add('Nome',2,nw>=2&&nw<=4?1:x.name?.65:.1,x.name||'ausente');
 const total=sections.reduce((a,s)=>a+s.weight*s.value,0)/sections.reduce((a,s)=>a+s.weight,0);
 return {score:r1(total*100),sections:sections.map(({name,weight,score,evidence})=>({name,weight,score,evidence})),inputs:x};
}
export function analyze(exp,manual={},now=new Date()) {
 const p=profileScore(exp,now),x=p.inputs;
 const n=k=>numeric(manual,k),b=k=>boolean(manual,k);
 const fb=n('featured_items');const rec=n('recommendations_count');const follow=n('follower_growth_30d');
 const visuals=[b('profile_photo'),b('cover_photo'),fb===null?null:band(fb,[[0,0],[1,.6],[3,1]])].filter(v=>v!==null);
 const visual=visuals.length?visuals.reduce((a,v)=>a+v,0)/visuals.length:null;
 const proof=rec===null?null:band(rec,[[0,.15],[1,.45],[2,.7],[4,1]]);
 const posts=band(x.posts_30d,[[0,.1],[1,.35],[2,.55],[4,.8],[8,1]]);
 const fol=follow===null?null:band(follow,[[0,.25],[5,.45],[20,.65],[50,.85],[100,1]]);
 const brand=aggregate([
 signal('Completude do perfil',6,p.score/100,`Score do perfil ${p.score}/100`),signal('Foto, capa e destaques',4,visual,'Checklist visual'),signal('Recomendações',4,proof,rec===null?'Não informado':`${rec} recomendações`),signal('Publicações',6,posts,`${x.posts_30d} posts/30d`),signal('Crescimento de seguidores',5,fol,follow===null?'Não informado':`+${follow}/30d`)]);
 const searches=n('people_searches_30d'),outbound=n('prospect_profile_views_30d'),inbound=n('inbound_profile_views_30d'),saved=n('saved_leads_30d'),days=n('active_days_30d'),networkQ=n('target_network_quality_0_10');
 const right=aggregate([
 signal('Buscas de pessoas',5,searches===null?null:band(searches,[[0,.1],[10,.35],[30,.6],[60,.8],[100,1]])),
 signal('Prospects visualizados',4,outbound===null?null:band(outbound,[[0,.1],[10,.35],[30,.6],[60,.85],[100,1]])),
 signal('Visualizações recebidas',4,inbound===null?null:band(inbound,[[0,.1],[20,.35],[50,.55],[100,.75],[250,1]])),
 signal('Prospects salvos',4,saved===null?null:band(saved,[[0,.1],[5,.35],[15,.6],[30,.8],[60,1]])),
 signal('Dias ativos',4,days===null?null:clamp(days/25)),signal('Qualidade da rede',4,networkQ===null?null:clamp(networkQ/10))]);
 const given=n('engagements_given_30d'),received=n('engagements_received_30d'),rate=n('avg_post_engagement_rate'),messages=n('messages_sent_30d'),response=n('message_response_rate'),groups=n('relevant_groups_count');
 const msgParts=[];if(messages!==null)msgParts.push(band(messages,[[0,.1],[5,.35],[15,.6],[30,.8],[60,1]]));if(response!==null)msgParts.push(clamp(response/60));
 const msgScore=msgParts.length?msgParts.reduce((a,v)=>a+v,0)/msgParts.length:null;
 const engage=aggregate([
 signal('Publicações',5,posts),signal('Engajamentos dados',4,given===null?null:band(given,[[0,.1],[20,.35],[50,.6],[100,.8],[200,1]])),
 signal('Engajamentos recebidos',4,received===null?null:band(received,[[0,.1],[20,.35],[75,.6],[150,.8],[300,1]])),
 signal('Taxa de engajamento',4,rate===null?null:band(rate,[[0,.1],[1,.35],[2,.55],[4,.8],[7,1]])),
 signal('Mensagens e respostas',5,msgScore),signal('Comunidades relevantes',3,groups===null?null:band(groups,[[0,.2],[1,.5],[3,.8],[5,1]]))]);
 const accept=n('acceptance_rate'),senior=n('senior_connections_quality_0_10'),icp=n('icp_connections_quality_0_10'),recurring=n('recurring_relationships_quality_0_10');
 const connections=band(x.connections_count,[[0,.05],[50,.25],[150,.5],[300,.75],[500,1]]);
 const relationships=aggregate([signal('Tamanho da rede',6,connections),signal('Aceitação dos convites',6,accept===null?null:clamp(accept/70)),signal('Rede de decisores',5,senior===null?null:clamp(senior/10)),signal('Rede dentro do ICP',5,icp===null?null:clamp(icp/10)),signal('Relações recorrentes',3,recurring===null?null:clamp(recurring/10))]);
 const pillars={professional_brand:{label:'Estabelecer marca profissional',...brand},find_right_people:{label:'Encontrar pessoas certas',...right},engage_with_insights:{label:'Interagir com insights',...engage},build_relationships:{label:'Construir relacionamentos',...relationships}};
 const estimated={score:r1(Object.values(pillars).reduce((a,v)=>a+v.score,0)),confidence:r1(Object.values(pillars).reduce((a,v)=>a+v.confidence,0)/4),pillars,profile_score:{score:p.score,sections:p.sections},engine_version:VERSION,disclaimer:'Estimativa independente. Não é a nota oficial do LinkedIn.'};
 const pos=aggregate([signal('Perfil completo',10,p.score/100),signal('Headline',5,p.sections.find(s=>s.name==='Headline').score/10),signal('Sobre',5,p.sections.find(s=>s.name==='Sobre').score/10)],20);
 const authority=aggregate([signal('Frequência de conteúdo',7,band(x.posts_30d,[[0,.1],[1,.3],[2,.5],[4,.75],[8,1]])),signal('Prova social',5,proof),signal('Engajamento recebido',5,received===null?null:band(received,[[0,.1],[20,.35],[75,.6],[150,.8],[300,1]])),signal('Crescimento audiência',3,follow===null?null:band(follow,[[0,.2],[5,.45],[20,.65],[50,.85],[100,1]]))],20);
 const network=aggregate([signal('Amplitude da rede',6,connections),signal('Aderência ao público',6,networkQ===null?null:clamp(networkQ/10)),signal('Presença do ICP',5,icp===null?null:clamp(icp/10)),signal('Decisores',3,senior===null?null:clamp(senior/10))],20);
 const personalEng=aggregate([signal('Interações intencionais',6,given===null?null:band(given,[[0,.1],[20,.35],[50,.6],[100,.8],[200,1]])),signal('Engajamento médio',7,rate===null?null:band(rate,[[0,.1],[1,.35],[2,.55],[4,.8],[7,1]])),signal('Respostas',7,response===null?null:clamp(response/60))],20);
 const leads=n('business_leads_30d'),conv=n('qualified_conversations_30d'),meetings=n('meetings_30d'),opps=n('opportunities_30d');
 const convert=aggregate([signal('Leads',5,leads===null?null:band(leads,[[0,0],[1,.3],[3,.55],[6,.8],[10,1]])),signal('Conversas qualificadas',5,conv===null?null:band(conv,[[0,0],[1,.3],[3,.55],[6,.8],[10,1]])),signal('Reuniões',5,meetings===null?null:band(meetings,[[0,0],[1,.35],[2,.6],[4,.85],[6,1]])),signal('Oportunidades',5,opps===null?null:band(opps,[[0,0],[1,.45],[2,.7],[4,1]]))],20);
 const dimensions={positioning:{label:'Posicionamento',...pos},authority:{label:'Autoridade e conteúdo',...authority},network:{label:'Rede e ICP',...network},engagement:{label:'Engajamento',...personalEng},conversion:{label:'Conversão comercial',...convert}};
 const own={score:r1(Object.values(dimensions).reduce((a,v)=>a+v.score,0)),confidence:r1(Object.values(dimensions).reduce((a,v)=>a+v.confidence,0)/5),dimensions,engine_version:VERSION};
 return {generated_at:now.toISOString(),engine_version:VERSION,files_detected:exp.names.sort(),ssi_estimated:estimated,ssi_figueira:own,manual_inputs:manual};
}
