import fs from 'fs';
import path from 'path';

function walk(dir: string, callback: (filepath: string) => void) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist') walk(filepath, callback);
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      callback(filepath);
    }
  }
}

walk('./src', (filepath) => {
  let content = fs.readFileSync(filepath, 'utf-8');
  // text-slate-900 inside a class name with bg-brand -> text-white
  // A naive approach: replace all `bg-brand text-slate-900` with `bg-brand text-white`
  // and `text-slate-950` as well
  let newContent = content.replace(/bg-brand\s+([^"']*?)text-slate-9[05]0/g, 'bg-brand $1text-white');
  newContent = newContent.replace(/text-slate-9[05]0\s+([^"']*?)bg-brand/g, 'text-white $1bg-brand');
  newContent = newContent.replace(/text-slate-[90]+0/g, (match) => {
    // We're mostly trying to fix contrast issues. Oh well, let's just use replace logic.
    return match;
  })

  // specific replacements
  newContent = newContent.replace(/activeTab === "siswa" \? "text-slate-900" :/g, 'activeTab === "siswa" ? "text-indigo-600" :');
  newContent = newContent.replace(/activeTab === "guru" \? "text-slate-900" :/g, 'activeTab === "guru" ? "text-indigo-600" :');

  if (newContent !== content) {
    fs.writeFileSync(filepath, newContent, 'utf-8');
    console.log(`Updated ${filepath}`);
  }
});
