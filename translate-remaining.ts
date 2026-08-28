import fs from 'fs';

let lp = fs.readFileSync('src/pages/LoginPage.tsx', 'utf8');
let ds = fs.readFileSync('src/pages/DashboardStudent.tsx', 'utf8');
let dt = fs.readFileSync('src/pages/DashboardTeacher.tsx', 'utf8');

function translate(content: string) {
  content = content.replace(/Live Sync/g, 'Sinkronisasi Langsung');
  content = content.replace(/Platform Administration/g, 'Administrasi Sistem');
  content = content.replace(/Live Analytics Advise/g, 'Saran Analitik Otomatis');
  content = content.replace(/Dashboard/g, 'Dasbor');
  content = content.replace(/Student Portal/g, 'Portal Siswa');
  content = content.replace(/Merapikan/g, 'Membersihkan');
  content = content.replace(/Administrator/g, 'Administrator');
  return content;
}

lp = translate(lp);
lp = lp.replace(/Tab Navigation/g, 'Navigasi Tab');
lp = lp.replace(/Global Footer for Desktop and Mobile/g, 'Catatan Kaki untuk Desktop dan Mobile');

ds = translate(ds);
dt = translate(dt);

fs.writeFileSync('src/pages/LoginPage.tsx', lp, 'utf8');
fs.writeFileSync('src/pages/DashboardStudent.tsx', ds, 'utf8');
fs.writeFileSync('src/pages/DashboardTeacher.tsx', dt, 'utf8');
