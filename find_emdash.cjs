const fs = require('fs');
const s = fs.readFileSync('C:/Users/usuario/Downloads/agenda-ba-eletrica/apps/api/src/email/templates.ts', 'utf8');
const lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('—')) {
    console.log((i+1) + ': ' + lines[i].trim().substring(0, 90));
  }
}