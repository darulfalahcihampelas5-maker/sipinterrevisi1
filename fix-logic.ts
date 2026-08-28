import fs from 'fs';

let content = fs.readFileSync('src/pages/DashboardTeacher.tsx', 'utf8');

content = content.replace(/Operational Logic/g, 'Logika Operasional');
content = content.replace(/Live Analytics Advise/g, 'Saran Analitik Otomatis');
content = content.replace(/File View/g, 'Tampilan File');
content = content.replace(/Assessment Input/g, 'Input Penilaian');

fs.writeFileSync('src/pages/DashboardTeacher.tsx', content, 'utf8');
