import fs from 'fs';

function applyStyleFixes(content: string) {
  // Fix weird text
  content = content.replace(/Dasbord Utama/g, 'Dasbor Utama');
  content = content.replace(/Dasbord Login/g, 'Dasbor Login');
  content = content.replace(/Dasbord/g, 'Dasbor');
  content = content.replace(/Selamat Datang Baru,/g, 'Selamat Datang,');

  // Modernize shadows & interactions
  content = content.replace(/shadow-md shadow-slate-200\/50/g, 'shadow-[0_8px_30px_rgb(0,0,0,0.04)]');
  content = content.replace(/shadow-sm shadow-indigo-200/g, 'shadow-[0_8px_20px_rgba(79,70,229,0.15)]');
  content = content.replace(/shadow-sm shadow-emerald-200/g, 'shadow-[0_8px_20px_rgba(16,185,129,0.15)]');
  content = content.replace(/ring-1 ring-slate-950\/5/g, 'border border-slate-200/60');
  content = content.replace(/backdrop-blur-xl/g, 'backdrop-blur-2xl bg-white/70');
  
  // Make inputs feel softer
  content = content.replace(/ring-1 ring-slate-200 focus:bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100/g, 'ring-1 ring-slate-200/60 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500');

  // Make buttons "bouncy"
  content = content.replace(/active:scale-\[0\.98\]/g, 'active:scale-95 transition-all duration-300');
  
  return content;
}

const files = [
  'src/pages/LoginPage.tsx',
  'src/pages/DashboardStudent.tsx',
  'src/pages/DashboardTeacher.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = applyStyleFixes(content);
  fs.writeFileSync(file, content, 'utf8');
}

console.log('UI optimizations applied!');
