// JSZip is loaded from the locally vendored, MIT-licensed script. No network calls.
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
  const headers=(rows.shift()||[]).map(v=>v.trim());
  return rows.map(values=>Object.fromEntries(headers.map((k,i)=>[k,String(values[i]??'').trim()])));
}

const limitBytes = 80 * 1024 * 1024;
const maxUncompressedCsv = 60 * 1024 * 1024;
const stripBom = value => value.replace(/^\uFEFF/, '');

export async function parseLinkedinZip(file) {
  if (!file?.name?.toLowerCase().endsWith('.zip')) throw new Error('Selecione o arquivo ZIP do LinkedIn.');
  if (file.size > limitBytes) throw new Error('ZIP muito grande (limite de 80 MB).');
  const jszip=globalThis.JSZip;
  if(!jszip) throw new Error('Biblioteca ZIP não disponível; recarregue a página.');
  const zipped=await jszip.loadAsync(await file.arrayBuffer());
  const files = {};
  const names = [];
  for (const item of Object.values(zipped.files)) {
    if (item.dir || !item.name.toLowerCase().endsWith('.csv')) continue;
    if (item._data?.uncompressedSize > maxUncompressedCsv) throw new Error('Há um CSV grande demais para análise local.');
    // All parsing is performed locally inside the browser.
    const content = stripBom(await item.async('string'));
    files[item.name] = parseCSV(content);
    names.push(item.name);
  }
  const exported = { files, names, findRows(...needles) {
    const namesLower = Object.keys(this.files).map(name=>({name, base: name.split('/').at(-1).toLowerCase()}));
    for (const needle of needles) {
      const exact = namesLower.find(x => x.base === needle.toLowerCase()+'.csv');
      if (exact) return this.files[exact.name];
    }
    for (const needle of needles) {
      const match = namesLower.find(x=>x.base.includes(needle.toLowerCase()));
      if (match) return this.files[match.name];
    }
    return [];
  }};
  if (!names.length) throw new Error('Nenhum CSV encontrado nesse ZIP.');
  if (!Object.keys(files).some(x=>x.split('/').at(-1).toLowerCase()==='profile.csv')) throw new Error('O arquivo Profile.csv não foi encontrado. Solicite o arquivo completo do LinkedIn.');
  return exported;
}

export function fromFixture(files) { return {files,names:Object.keys(files), findRows(...needles) { for (const n of needles) { const key = Object.keys(files).find(k=>k.toLowerCase().split('/').at(-1)===n.toLowerCase()+'.csv');if(key)return files[key]; } for(const n of needles){const key=Object.keys(files).find(k=>k.toLowerCase().split('/').at(-1).includes(n.toLowerCase()));if(key)return files[key];}return []; }}; }
