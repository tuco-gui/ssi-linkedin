const PRIMARY_PROFILE_ACTOR = 'linkedintel-core~linkedin-profile-scraper-no-cookies';
const SECONDARY_PROFILE_ACTOR = 'datascrapers~linkedin-profile-scraper';
const FALLBACK_PROFILE_ACTOR = 'atomus~linkedin-profile-scraper';
const POSTS_ACTOR = 'harvestapi~linkedin-profile-posts';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function validateProfileUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.protocol !== 'https:' || !/(^|\.)linkedin\.com$/i.test(u.hostname) || !/^\/in\//i.test(u.pathname)) return null;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch { return null; }
}

async function runActor(actor, input, token) {
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=55`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(58000)
  });
  const text = await r.text();
  if (!r.ok) {
    let detail='';
    try { const parsed=JSON.parse(text); detail=parsed?.error?.message||parsed?.message||''; } catch {}
    throw new Error(`${actor} respondeu ${r.status}${detail?': '+detail:''}`);
  }
  try {
    const data=JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    throw new Error(`${actor} retornou um formato inesperado`);
  }
}

const firstNum = (...values) => {
  for (const v of values) {
    if(v===null||v===undefined||v==='')continue;
    const cleaned = typeof v === 'string' ? v.replace(/,/g,'').replace(/[^0-9.+-]/g,'') : v;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
};
const firstText = (...values) => values.find(v => typeof v === 'string' && v.trim())?.trim() || '';
const arr = v => Array.isArray(v) ? v : [];

function diagnosticFrom(records){
  const msgs=[];
  for(const r of records||[]){
    const type=String(r?.type||r?.status||'').toLowerCase();
    if(type.includes('diagnostic')||type==='error'||type==='not_found'||r?.error||r?.reason){
      const msg=firstText(r?.reason,r?.error,r?.message,r?.details,r?.error_kind);
      if(msg)msgs.push(msg);
    }
  }
  return [...new Set(msgs)].slice(0,3);
}

function normalizeProfile(records) {
  const wrapper = records.find(r => r?.status === 'success' && r?.profile)?.profile || null;
  const profileRecord = records.find(r => String(r?.type || '').toLowerCase() === 'profile')
    || records.find(r => r && (r.followerCount != null || r.profilePictureUrl || r.fullName || r.full_name || r.name || r.profileImageUrl))
    || {};
  const profile = wrapper || profileRecord;
  const type = r => String(r?.type || '').toLowerCase();

  const recommendations = records.filter(r => type(r).includes('recommendation'));
  const received = recommendations.filter(r => {
    const tag = `${r.direction || ''} ${r.recommendationType || ''} ${r.category || ''} ${r.bucket || ''}`.toLowerCase();
    return !tag || tag.includes('received') || tag.includes('receive');
  });
  const interests = records.filter(r => type(r).includes('interest'));
  const groups = interests.filter(r => String(r.bucket || r.category || '').toLowerCase().includes('group'));

  const groupedExperience = arr(profile.position_groups).flatMap(g =>
    arr(g.profile_positions).map(pos => ({
      ...pos,
      companyName:firstText(pos?.company?.name,g?.company?.name,pos?.companyName),
      startDate:firstText(pos?.date?.start,g?.date?.start,pos?.startDate),
      endDate:firstText(pos?.date?.end,g?.date?.end,pos?.endDate)
    }))
  );
  const experience = arr(profile.experience).length ? arr(profile.experience)
    : arr(profile.positions).length ? arr(profile.positions)
    : groupedExperience.length ? groupedExperience
    : records.filter(r => type(r).includes('experience'));

  const education = arr(profile.education).length ? arr(profile.education)
    : arr(profile.educations).length ? arr(profile.educations)
    : records.filter(r => type(r).includes('education'));
  const skills = arr(profile.skills).length ? arr(profile.skills) : records.filter(r => type(r).includes('skill'));
  const certifications = arr(profile.certifications).length ? arr(profile.certifications) : records.filter(r => type(r).includes('certification'));
  const languages = arr(profile.languages).length ? arr(profile.languages)
    : arr(profile?.languages?.supported_locales).length ? arr(profile.languages.supported_locales)
    : records.filter(r => type(r).includes('language'));

  const location = typeof profile.location === 'object' && profile.location
    ? firstText(profile.location.default,profile.location.short,profile.location.full,profile.location.city,profile.location.country)
    : firstText(profile.locationFull,profile.location,profile.city,profile.country);

  const recommendationsEmbedded = arr(profile.recommendations).length ? arr(profile.recommendations).length : null;
  return {
    raw: profile,
    name: firstText(profile.fullName, profile.full_name, profile.name, [profile.firstName||profile.first_name, profile.lastName||profile.last_name].filter(Boolean).join(' ')),
    firstName: firstText(profile.firstName,profile.first_name),
    lastName: firstText(profile.lastName,profile.last_name),
    headline: firstText(profile.headline, profile.currentTitle, profile.title, profile.jobTitle),
    summary: firstText(profile.summary, profile.about, profile.description),
    location,
    industry: firstText(profile.industryName, profile.industry, profile.company?.industry),
    followers: firstNum(profile.followerCount, profile.followers, profile.follower_count),
    connections: firstNum(profile.connectionsCount, profile.connections, profile.connectionCount, profile.connection_count),
    photo: firstText(profile.profilePictureUrl, profile.profilePicture, profile.pictureUrl, profile.avatar, profile.profileImageUrl, profile.profile_image_url, profile.picture_url),
    cover: firstText(profile.backgroundImageUrl, profile.backgroundPicture, profile.backgroundUrl, profile.coverImageUrl, profile.background_image_url, profile.background_url, profile.backgroundPic),
    recommendationsReceived: received.length || (recommendations.length ? recommendations.length : recommendationsEmbedded),
    groupsCount: groups.length || null,
    experience,
    education,
    skills,
    certifications,
    languages,
    interests
  };
}

async function fetchProfile(profileUrl,token){
  const attempts=[
    {
      actor:PRIMARY_PROFILE_ACTOR,
      input:{profileUrls:[profileUrl],includeAbout:true,includeRecommendations:true,includeInterests:true,includeSimilar:false}
    },
    {
      actor:SECONDARY_PROFILE_ACTOR,
      input:{profiles:[profileUrl],concurrency:1}
    },
    {
      actor:FALLBACK_PROFILE_ACTOR,
      input:{profileUrls:[profileUrl],includeCompanyDetails:false}
    }
  ];
  const diagnostics=[];
  for(const attempt of attempts){
    try{
      const records=await runActor(attempt.actor,attempt.input,token);
      diagnostics.push(...diagnosticFrom(records).map(x=>`${attempt.actor}: ${x}`));
      const profile=normalizeProfile(records);
      if(profile.name||profile.headline){
        return {profile,records,source:attempt.actor,diagnostics};
      }
    }catch(e){
      diagnostics.push(e?.message||String(e));
    }
  }
  const detail=diagnostics.length ? ` Detalhe: ${diagnostics.slice(0,2).join(' | ')}` : '';
  throw new Error('As fontes públicas não conseguiram resolver este perfil pelo link.'+detail);
}

function normalizePosts(records, followers) {
  const now = Date.now();
  const cutoff = now - 30 * 86400000;
  const posts = records.filter(r => String(r?.type || '').toLowerCase() === 'post' || r?.engagement || r?.postedAt);
  const recent = posts.filter(p => {
    const ts = firstNum(p?.postedAt?.timestamp, p?.timestamp, Date.parse(p?.postedAt?.date || p?.publishedAt || p?.postedAt || ''));
    return ts && ts >= cutoff && ts <= now + 86400000;
  });
  let received = 0, views = 0, viewSeen = false;
  for (const p of recent) {
    const e = p.engagement || {};
    received += firstNum(e.likes, e.reactionsCount, p.reactionsCount, p.likes, 0) || 0;
    received += firstNum(e.comments, p.commentsCount, p.commentCount, 0) || 0;
    received += firstNum(e.shares, p.sharesCount, p.shareCount, p.reposts, 0) || 0;
    const v = firstNum(e.views, e.impressions, p.views, p.viewCount, p.impressions);
    if (v != null) { views += v; viewSeen = true; }
  }
  const engagementRate = followers && recent.length ? (received / recent.length / followers) * 100 : null;
  return {all: posts, recent, received, views: viewSeen ? views : null, engagementRate};
}

function fixture(profile, posts) {
  const p = profile;
  const profileRow = {
    'First Name': p.firstName,
    'Last Name': p.lastName,
    'Name': p.name,
    'Headline': p.headline,
    'Summary': p.summary,
    'Geo Location': p.location,
    'Industry': p.industry
  };
  const positions = p.experience.map(x => ({
    Title: firstText(x.title, x.position, x.currentTitle),
    Description: firstText(x.description, x.summary),
    'Company Name': firstText(x.companyName, typeof x.company==='string'?x.company:'', x.company?.name),
    'Started On': firstText(x.startDate, x.start, x.dateRange, x.date?.start),
    'Finished On': firstText(x.endDate, x.end, x.date?.end)
  }));
  const skills = p.skills.map(x => ({Name:firstText(x?.name, x?.skill, typeof x === 'string' ? x : '')}));
  const education = p.education.map(x => ({School:firstText(x?.schoolName, typeof x?.school==='string'?x.school:'', x?.school?.name, x?.name)}));
  const certifications = p.certifications.map(x => ({Name:firstText(x?.name, x?.title, typeof x==='string'?x:'')}));
  const languages = p.languages.map(x => ({Name:firstText(x?.name, x?.language, typeof x==='string'?x:'')}));
  const shares = posts.recent.map(x => ({Date:firstText(x?.postedAt?.date, x?.publishedAt), URL:firstText(x.linkedinUrl, x.postUrl), Comment:firstText(x.content, x.text)}));
  const connections = Array.from({length: Math.min(500, Math.max(0, Math.round(p.connections || 0)))}, (_,i)=>({'First Name':`Conexão ${i+1}`}));
  return {
    'Profile.csv':[profileRow],
    'Positions.csv':positions,
    'Skills.csv':skills,
    'Education.csv':education,
    'Certifications.csv':certifications,
    'Languages.csv':languages,
    'Shares.csv':shares,
    'Connections.csv':connections
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, {error:'Método não permitido'});
  const profileUrl = validateProfileUrl(req.body?.profileUrl);
  if (!profileUrl) return json(res, 400, {error:'Use um link válido de perfil do LinkedIn (linkedin.com/in/...).'});
  const token = process.env.APIFY_TOKEN;
  if (!token) return json(res, 503, {error:'A fonte automática ainda não foi configurada no servidor.', code:'SOURCE_NOT_CONFIGURED'});

  try {
    const profilePromise=fetchProfile(profileUrl,token);
    const postsPromise=runActor(POSTS_ACTOR,{
      targetUrls:[profileUrl],
      maxPosts:30,
      postedLimit:'month',
      scrapeReactions:false,
      scrapeComments:false,
      includeQuotePosts:true,
      includeReposts:true
    },token).then(records=>({records,error:null})).catch(e=>({records:[],error:e?.message||String(e)}));

    const [{profile,source,diagnostics},postResult]=await Promise.all([profilePromise,postsPromise]);
    let publicPosts=postResult.records;
    if(!publicPosts.length && Array.isArray(profile.raw?.activities)){
      publicPosts=profile.raw.activities.map(a=>({
        type:'post',
        content:a.text||a.title||'',
        postUrl:a.postUrl||a.url||'',
        postedAt:{date:a.date||a.publishedAt||'',timestamp:a.timestamp||null},
        engagement:{likes:firstNum(a.likes,a.likeCount,0),comments:firstNum(a.comments,a.commentCount,0),shares:firstNum(a.shares,a.shareCount,0)}
      }));
    }
    const posts = normalizePosts(publicPosts, profile.followers);
    const notes=['Dados públicos do perfil e posts. Não inclui ações privadas da conta nem Sales Navigator.'];
    if(postResult.error && !publicPosts.length)notes.push('Posts recentes indisponíveis nesta consulta: '+postResult.error);
    if(diagnostics.length)notes.push(...diagnostics.slice(0,2));

    return json(res, 200, {
      source:'apify-public-linkedin',
      profileSource:source,
      capturedAt:new Date().toISOString(),
      profileUrl,
      profile:{
        name:profile.name,
        headline:profile.headline,
        followers:profile.followers,
        connections:profile.connections,
        photo:Boolean(profile.photo),
        cover:Boolean(profile.cover),
        recommendationsReceived:profile.recommendationsReceived,
        groupsCount:profile.groupsCount
      },
      metrics:{
        profile_photo:profile.photo ? true : null,
        cover_photo:profile.cover ? true : null,
        recommendations_count:profile.recommendationsReceived,
        relevant_groups_count:profile.groupsCount,
        engagements_received_30d:postResult.error ? null : posts.received,
        avg_post_engagement_rate:posts.engagementRate
      },
      postStats:{
        posts30d:postResult.error ? null : posts.recent.length,
        engagementsReceived30d:postResult.error ? null : posts.received,
        viewsOrImpressions30d:posts.views
      },
      fixture:fixture(profile, posts),
      notes
    });
  } catch (e) {
    return json(res, 502, {error:e?.message || 'Falha ao consultar a fonte automática.'});
  }
}
