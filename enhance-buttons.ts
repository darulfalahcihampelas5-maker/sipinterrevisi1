import fs from 'fs';

function applyBetterButtons(content: string) {
  // Common buttons
  content = content.replace(/bg-indigo-600 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-\[0_8px_20px_rgba\(79,70,229,0\.15\)\] hover:bg-indigo-700 active:scale-95 transition-all duration-300\s*/g, 'rounded-2xl text-sm btn-primary ');
  content = content.replace(/bg-emerald-600 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-\[0_8px_20px_rgba\(16,185,129,0\.15\)\] hover:bg-emerald-700 active:scale-95 transition-all duration-300\s*/g, 'rounded-2xl text-sm btn-success ');
  
  // Dashboard Teacher buttons
  content = content.replace(/bg-indigo-600 text-white font-black text-xs uppercase tracking-\[0\.3em\] shadow-md shadow-indigo-600\/40 hover:bg-white hover:text-slate-900 hover:scale-\[1\.02\] active:scale-95 transition-all duration-300\s*/g, 'rounded-2xl text-xs btn-primary hover:text-white drop-shadow-md '); // Drop shadow fix
  content = content.replace(/bg-indigo-600 px-10 text-xs font-black text-white uppercase tracking-\[0\.2em\] shadow-md shadow-indigo-600\/20  hover:bg-indigo-700 active:scale-95 transition-all duration-300 whitespace-nowrap/g, 'rounded-2xl px-10 text-xs btn-primary whitespace-nowrap');
  
  // Dashboard Student buttons
  content = content.replace(/bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-600\/20/g, 'btn-primary');
  content = content.replace(/bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600\/20/g, 'btn-danger');

  // Any left over raw shadows
  content = content.replace(/shadow-md shadow-slate-900\/30/g, 'shadow-elegant');
  content = content.replace(/shadow-sm shadow-slate-900\/10/g, 'shadow-soft');
  
  // The 'Admin Portal' / 'Sistem Akademik Terpadu'
  content = content.replace(/Sistem Akademik Terpadu/g, 'Sistem Akademik Terpadu (Si-Pinter)');
  
  return content;
}

const files = [
  'src/pages/LoginPage.tsx',
  'src/pages/DashboardStudent.tsx',
  'src/pages/DashboardTeacher.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = applyBetterButtons(content);
  fs.writeFileSync(file, content, 'utf8');
}
