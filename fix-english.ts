import fs from 'fs';

let content = fs.readFileSync('src/pages/DashboardTeacher.tsx', 'utf8');

// Replacements
content = content.replace(/Zero Signal Detected/g, 'Tidak Ada Data Ditemukan');
content = content.replace(/Grade Analytics/g, 'Analisis Nilai');
content = content.replace(/Save Now/g, 'Simpan Sekarang');
content = content.replace(/Processing Security\.\.\./g, 'Memproses Keamanan...');
content = content.replace(/Validate & Save/g, 'Validasi & Simpan');
content = content.replace(/Mass Import Suite/g, 'Sistem Impor Massal');
content = content.replace(/Push to Enterprise Pipeline/g, 'Unggah ke Sistem');

fs.writeFileSync('src/pages/DashboardTeacher.tsx', content, 'utf8');
