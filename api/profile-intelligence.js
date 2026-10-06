const PROFILE_ACTOR = 'linkedintel-core~linkedin-profile-scraper-no-cookies';
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
  if (!r.ok) throw new Error(`Fonte automática respondeu ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

const firstNum = (...values) => {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};
const firstText = (...values) => values.find(v => typeof v === 'string' && v.trim())?.trim() || '';
const arr = v => Array.isArray(v) ? v : [];

function normalizeProfile(records) {
  const profile = records.find(r => String(r?.type || '').toLowerCase() === 'profile')
    || records.find(r => r && (r.followerCount != null || r.profilePictureUrl || r.fullName))
    || {};
  const type = r => String(r?.type || '').toLowerCase();
  const recommendations = records.filter(r => type(r).includes('recommendation'));
  const received = recommendations.filter(r => {
    const tag = `${r.direction || ''} ${r.recommendationType || ''} ${r.category || ''} ${r.bucket || ''}`.toLowerCase();
    return !tag || tag.includes('received') || tag.includes('receive');
  });
  const interests = records.filter(r => type(r).includes('interest'));
  const groups = interests.filter(r => String(r.bucket || r.category || '').toLowerCase().includes('group'));

  const experience = arr(profile.experience).length ? arr(profile.experience) : records.filter(r => type(r).includes('experience'));
  const education = arr(profile.education).length ? arr(profile.education) : records.filter(r => type(r).includes('education'));
  const skills = arr(profile.skills).length ? arr(profile.skills) : records.filter(r => type(r).includes('skill'));
  const certifications = arr(profile.certifications).length ? arr(profile.certifications) : records.filter(r => type(r).includes('certification'));
  const languages = arr(profile.languages).length ? arr(profile.languages) : records.filter(r => type(r).includes('language'));

  return {
    raw: profile,
    name: firstText(profile.fullName, [profile.firstName, profile.lastName].filter(Boolean).join(' ')),
    firstName: firstText(profile.firstName),
    lastName: firstText(profile.lastName),
    headline: firstText(profile.headline, profile.currentTitle),
    summary: firstText(profile.summary, profile.about),
    location: firstText(profile.locationFull, profile.city, profile.country),
    industry: firstText(profile.industryName, profile.industry),
    followers: firstNum(profile.followerCount, profile.followers),
    connections: firstNum(profile.connectionsCount, profile.connections),
    photo: firstText(profile.profilePictureUrl, profile.pictureUrl, profile.avatar),
    cover: firstText(profile.backgroundImageUrl, profile.backgroundUrl, profile.coverImageUrl),
    recommendationsReceived: received.length || (recommendations.length ? recommendations.length : null),
    groupsCount: groups.length || null,
    experience,
    education,
    skills,
    certifications,
    languages,
    interests
  };
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
    received += firstNum(e.likes, e.reactionsCount, p.reactions, p.likes, 0) || 0;
    received += firstNum(e.comments, p.comments, p.commentCount, 0) || 0;
    received += firstNum(e.shares, p.shares, p.shareCount, p.reposts, 0) || 0;
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
    'Headline': p.headline,
    'Summary': p.summary,
    'Geo Location': p.location,
    'Industry': p.industry
  };
  const positions = p.experience.map(x => ({
    Title: firstText(x.title, x.position, x.currentTitle),
    Description: firstText(x.description, x.summary),
    'Company Name': firstText(x.companyName, x.company, x.company?.name),
    'Started On': firstText(x.startDate, x.start, x.dateRange),
    'Finished On': firstText(x.endDate, x.end)
  }));
  const skills = p.skills.map(x => ({Name:firstText(x.name, x.skill, String(typeof x === 'string' ? x : ''))}));
  const education = p.education.map(x => ({School:firstText(x.schoolName, x.school, x.name)}));
  const certifications = p.certifications.map(x => ({Name:firstText(x.name, x.title)}));
  const languages = p.languages.map(x => ({Name:firstText(x.name, x.language)}));
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
    const since = new Date(Date.now()-31*86400000).toISOString().slice(0,10);
    const [profileRecords, postRecords] = await Promise.all([
      runActor(PROFILE_ACTOR, {profileUrls:[profileUrl], includeAbout:true, includeRecommendations:true, includeInterests:true, includeSimilar:false}, token),
      runActor(POSTS_ACTOR, {targetUrls:[profileUrl], maxPosts:30, postedLimitDate:since, scrapeReactions:false, scrapeComments:false, includeQuotePosts:true, includeReposts:true}, token)
    ]);
    const profile = normalizeProfile(profileRecords);
    if (!profile.name && !profile.headline) throw new Error('O perfil não retornou dados públicos suficientes.');
    const posts = normalizePosts(postRecords, profile.followers);
    return json(res, 200, {
      source:'apify-public-linkedin',
      capturedAt:new Date().toISOString(),
      profileUrl,
      profile:{name:profile.name,headline:profile.headline,followers:profile.followers,connections:profile.connections,photo:Boolean(profile.photo),cover:Boolean(profile.cover),recommendationsReceived:profile.recommendationsReceived,groupsCount:profile.groupsCount},
      metrics:{
        profile_photo:Boolean(profile.photo),
        cover_photo:Boolean(profile.cover),
        recommendations_count:profile.recommendationsReceived,
        relevant_groups_count:profile.groupsCount,
        engagements_received_30d:posts.received,
        avg_post_engagement_rate:posts.engagementRate
      },
      postStats:{posts30d:posts.recent.length,engagementsReceived30d:posts.received,viewsOrImpressions30d:posts.views},
      fixture:fixture(profile, posts),
      notes:['Dados públicos do perfil e posts. Não inclui ações privadas da conta nem Sales Navigator.']
    });
  } catch (e) {
    return json(res, 502, {error:e?.message || 'Falha ao consultar a fonte automática.'});
  }
}
