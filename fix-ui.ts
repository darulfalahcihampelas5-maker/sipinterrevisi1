import fs from 'fs';

// --- Fix LoginPage ---
let lpContent = fs.readFileSync('src/pages/LoginPage.tsx', 'utf8');

// Fix error rendering
lpContent = lpContent.replace(
  /<div className="mb-10">\s*<div className="p-3 bg-rose-50 rounded-xl border border-rose-100 flex gap-3 items-center mt-6">\s*<AlertCircle className="w-5 h-5 text-rose-500 shrink-0" \/>\s*<p className="text-xs font-bold text-rose-600 italic leading-tight">\{nisnError\}<\/p>\s*<\/div>\s*<\/div>/g,
  `{nisnError && (
    <div className="mb-10">
      <div className="p-3 bg-rose-50 rounded-xl border border-rose-100 flex gap-3 items-center mt-6">
        <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
        <p className="text-xs font-bold text-rose-600 italic leading-tight">{nisnError}</p>
      </div>
    </div>
  )}`
);

// Better English terms in branding text
lpContent = lpContent.replace(/Digital<br \/>\s*Education<br \/>\s*<span className="text-indigo-500 italic font-serif">Simplified.<\/span>/g, `Pendidikan<br />\nDigital<br />\n<span className="text-indigo-500 italic font-serif">Lebih Mudah.</span>`);

fs.writeFileSync('src/pages/LoginPage.tsx', lpContent, 'utf8');

// --- Fix DashboardStudent ---
let dsContent = fs.readFileSync('src/pages/DashboardStudent.tsx', 'utf8');

dsContent = dsContent.replace(/Submitted/g, 'Mengumpul');
dsContent = dsContent.replace(/Graded/g, 'Dinilai');
dsContent = dsContent.replace(/On Review/g, 'Ditinjau');
dsContent = dsContent.replace(/Assignment/g, 'Tugas');
dsContent = dsContent.replace(/Chapter/g, 'Modul');
dsContent = dsContent.replace(/Final Score/g, 'Nilai Akhir');

fs.writeFileSync('src/pages/DashboardStudent.tsx', dsContent, 'utf8');

// --- Fix DashboardTeacher ---
let dtContent = fs.readFileSync('src/pages/DashboardTeacher.tsx', 'utf8');

dtContent = dtContent.replace(/Status/g, 'Keterangan');
dtContent = dtContent.replace(/Synchronizing Node\.\.\./g, 'Menyimpan Data...');
dtContent = dtContent.replace(/Deploy Global Payload/g, 'Publikasikan Tugas');
dtContent = dtContent.replace(/Update Master Record/g, 'Perbarui Tugas');
dtContent = dtContent.replace(/Active Record/g, 'Tugas Aktif');
dtContent = dtContent.replace(/Collaborative Mode Active/g, 'Mode Kolaborasi');
dtContent = dtContent.replace(/Global Manifest/g, 'Semua Data');
dtContent = dtContent.replace(/Encrypted database entry/g, 'Basis Data Aman');

fs.writeFileSync('src/pages/DashboardTeacher.tsx', dtContent, 'utf8');

console.log("UI text and bug improvements applied");
