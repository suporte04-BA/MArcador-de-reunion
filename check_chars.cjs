const fs = require('fs');
const s = fs.readFileSync('C:/Users/usuario/Downloads/agenda-ba-eletrica/apps/api/src/email/templates.ts', 'utf8');
const nonLatin1 = new Set();
for (const c of s) {
  const cp = c.charCodeAt(0);
  if (cp > 255) nonLatin1.add(c);
}
console.log('non-Latin1 chars:', [...nonLatin1].map(c => c + ' (U+' + c.charCodeAt(0).toString(16) + ')'));
PY