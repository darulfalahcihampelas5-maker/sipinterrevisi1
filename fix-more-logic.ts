import fs from 'fs';
let content = fs.readFileSync('src/pages/DashboardTeacher.tsx', 'utf8');

content = content.replace(/System Keterangan/g, 'Status Pekerjaan');
content = content.replace(/Deployment Timing/g, 'Pilih Tanggal Rilis');
content = content.replace(/System Flush/g, 'Pembersihan Sistem');
content = content.replace(/edu-si-pinter-master/g, 'edu-si-pinter-utama');
content = content.replace(/edu-si-pinter-student/g, 'edu-si-pinter-siswa');
content = content.replace(/Platform Administration/g, 'Administrasi Sistem');

fs.writeFileSync('src/pages/DashboardTeacher.tsx', content, 'utf8');
