import fs from 'fs';

function modernize(content: string) {
  // Common fixes
  // Change rounded-[2.5rem] bg-white p-10 shadow-... to generic bento-card
  content = content.replace(/rounded-\[2\.5rem\] bg-white p-10 lg:p-12 shadow-\[0_8px_30px_rgb\(0,0,0,0\.04\)\] border border-slate-100 relative overflow-hidden border border-slate-200\/60/g, 'bento-card p-10 lg:p-12 relative overflow-hidden');
  content = content.replace(/rounded-\[2\.5rem\] bg-white p-8 lg:p-12 shadow-\[0_8px_30px_rgb\(0,0,0,0\.04\)\] border border-slate-100 ring-1 ring-slate-950\/5/g, 'bento-card p-8 lg:p-12 relative');
  content = content.replace(/rounded-\[2\.5rem\] p-8 sm:p-12 bg-white border border-slate-100 shadow-[^ ]+ relative overflow-hidden/g, 'bento-card p-8 sm:p-12 relative overflow-hidden');
  content = content.replace(/bg-white\/80 backdrop-blur-2xl/g, 'glass-panel');
  
  // Dashboard text
  content = content.replace(/Dashboard Guru/g, 'Dasbor Guru');
  
  // Make the tables look better
  content = content.replace(/divide-y divide-slate-100/g, 'divide-y divide-slate-100/60');
  
  return content;
}

const files = [
  'src/pages/LoginPage.tsx',
  'src/pages/DashboardStudent.tsx',
  'src/pages/DashboardTeacher.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = modernize(content);
  fs.writeFileSync(file, content, 'utf8');
}
