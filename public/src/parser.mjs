// JSZip is loaded from the vendored browser script. LinkedIn ZIP parsing stays local.
const normName = value => String(value||'').toLowerCase().replace(/\.csv$/,'').replace(/[_\-]+/g,' ').replace(/\s+/g,' ').trim();

function parseCSV(input) {
  const rows=[];let row=[], field='', quoted=false;
  for(let i=0;i<input.length;i++) {
    const c=input[i];
    if(quoted){if(c==='"'&&input[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;}else{field+=c;}}
    else if(c==='"'){quoted=true;}
    else if(c===','){row.push(field);field='';}
    else if(c==='\r'||c==='\n'){if(c==='\r'&&input[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>v.trim()))rows.push(row);row=[];}
    else{field+=c;}
  }
  row.push(field);if(row.some(v=>v.trim()))rows.push(row);

  // Some LinkedIn CSVs (especially Connections.csv) start with explanatory note rows.
  const knownHeaders=/^(first name|last name|url|email address|company|position|connected on|from|to|sent at|message|direction|headline|summary|name|date|created at|time|title)$/i;
  let headerIndex=0;
  for(let i=0;i<Math.min(rows.length,12);i++){
    const cells=rows[i].map(v=>String(v||'').trim()).filter(Boolean);
    const hits=cells.filter(v=>knownHeaders.test(v)).length;
    if(cells.length>=2 && hits>=Math.min(2,cells.length)){headerIndex=i;break;}
  }
  const headers=(rows[headerIndex]||[]).map(v=>v.trim());
  if(!headers.length)return [];
  return rows.slice(headerIndex+1)
    .filter(values=>values.some(v=>String(v||'').trim()))
    .map(values=>Object.fromEntries(headers.map((k,i)=>[k,String(values[i]??'').trim()])));
}

const limitBytes = 80 * 1024 * 1024;
const maxUncompressedCsv = 60 * 1024 * 1024;
const stripBom = value => value.replace(/^\uFEFF/, '');

function makeExport(files){
  return {
    files,
    names:Object.keys(files),
    findRows(...needles){
      const refs=Object.keys(this.files).map(name=>({name,base:normName(name.split('/').at(-1))}));
      for(const needle of needles){
        const n=normName(needle);
        const exact=refs.find(x=>x.base===n);
        if(exact)return this.files[exact.name];
      }
      for(const needle of needles){
        const n=normName(needle);
        const match=refs.find(x=>x.base.includes(n));
        if(match)return this.files[match.name];
      }
      return [];
    }
  };
}

export async function parseLinkedinZip(file) {
  if (!file?.name?.toLowerCase().endsWith('.zip')) throw new Error('Selecione o arquivo ZIP do LinkedIn.');
  if (file.size > limitBytes) throw new Error('ZIP muito grande (limite de 80 MB).');
  const jszip=globalThis.JSZip;
  if(!jszip) throw new Error('Biblioteca ZIP não disponível; recarregue a página.');
  const zipped=await jszip.loadAsync(await file.arrayBuffer());
  const files = {};
  for (const item of Object.values(zipped.files)) {
    if (item.dir || !item.name.toLowerCase().endsWith('.csv')) continue;
    if (item._data?.uncompressedSize > maxUncompressedCsv) throw new Error('Há um CSV grande demais para análise local.');
    const content = stripBom(await item.async('string'));
    files[item.name] = parseCSV(content);
  }
  const names=Object.keys(files);
  if (!names.length) throw new Error('Nenhum CSV encontrado nesse ZIP.');
  if (!names.some(x=>normName(x.split('/').at(-1))==='profile')) throw new Error('O arquivo Profile.csv não foi encontrado. Solicite uma exportação do LinkedIn que inclua o perfil.');
  return makeExport(files);
}

export function fromFixture(files) { return makeExport(files); }

export function mergeExports(primary,secondary){
  if(!primary)return secondary;
  if(!secondary)return primary;
  const files={...secondary.files,...primary.files};

  const pProfile=primary.findRows('profile')[0]||{};
  const sProfile=secondary.findRows('profile')[0]||{};
  if(Object.keys(pProfile).length||Object.keys(sProfile).length){
    const key=Object.keys(primary.files).find(k=>normName(k.split('/').at(-1))==='profile')
      || Object.keys(secondary.files).find(k=>normName(k.split('/').at(-1))==='profile')
      || 'Profile.csv';
    files[key]=[{...sProfile,...Object.fromEntries(Object.entries(pProfile).filter(([,v])=>String(v??'').trim()!==''))}];
  }

  for(const base of ['positions','skills','education','certifications','languages']){
    const p=primary.findRows(base), s=secondary.findRows(base);
    const key=Object.keys(primary.files).find(k=>normName(k.split('/').at(-1)).includes(base))
      || Object.keys(secondary.files).find(k=>normName(k.split('/').at(-1)).includes(base));
    if(key)files[key]=p.length>=s.length?p:s;
  }

  const pShares=primary.findRows('shares','posts'), sShares=secondary.findRows('shares','posts');
  if(sShares.length){
    const key=Object.keys(primary.files).find(k=>['share','shares','post','posts'].includes(normName(k.split('/').at(-1))))
      || Object.keys(secondary.files).find(k=>['share','shares','post','posts'].includes(normName(k.split('/').at(-1))))
      || 'Shares.csv';
    const seen=new Set(), merged=[];
    for(const r of [...pShares,...sShares]){
      const sig=JSON.stringify(r);
      if(!seen.has(sig)){seen.add(sig);merged.push(r);}
    }
    files[key]=merged;
  }

  // Real Connections.csv from the user's archive is always preferable to synthetic/public counts.
  const pConn=primary.findRows('connections');
  if(pConn.length){
    const key=Object.keys(primary.files).find(k=>normName(k.split('/').at(-1))==='connections')||'Connections.csv';
    files[key]=pConn;
  }
  return makeExport(files);
}
