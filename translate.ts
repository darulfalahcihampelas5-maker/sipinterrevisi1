import fs from 'fs';
import path from 'path';

let content = fs.readFileSync('src/pages/DashboardTeacher.tsx', 'utf8');

content = content.replace(/Select Academic Unit\.\.\./g, 'Pilih Kelas...');
content = content.replace(/Select Chapter\.\.\./g, 'Pilih Bab...');
content = content.replace(/e\.g\. XII MIPA 4/g, 'cth. XII MIPA 4');
content = content.replace(/e\.g\. Alana Wijaya/g, 'cth. Alana Wijaya');
content = content.replace(/9-Digit Numerical ID/g, 'ID Numerik 9 Digit');
content = content.replace(/Scan registry by name or NISN\.\.\./g, 'Cari siswa berdasarkan nama atau NISN...');
content = content.replace(/"CONFIRM"/g, '"KONFIRMASI"');
content = content.replace(/"CANCEL"/g, '"BATAL"');
content = content.replace(/New Chapter\.\.\./g, 'Bab Baru...');
content = content.replace(/e\.g\. Arsitektur Komputer & Jaringan/g, 'cth. Arsitektur Komputer & Jaringan');
content = content.replace(/Global Manifest \(All Tasks\)/g, 'Semua Tugas');
content = content.replace(/Objective Selector/g, 'Pilih Tujuan');
content = content.replace(/Partition Selection\.\.\./g, 'Pilih Kelas...');
content = content.replace(/Enter structured instructions \(Markdown supported\)\.\.\./g, 'Masukkan instruksi tugas (mendukung Markdown)...');

content = content.replace(/>CONFIRM</g, '>KONFIRMASI<');
content = content.replace(/>Admin Portal</g, '>Portal Admin<');
content = content.replace(/>App Version 3.4.0</g, '>Versi Aplikasi 3.4.0<');
content = content.replace(/>Global student database is empty</g, '>Database siswa global kosong<');
content = content.replace(/>Encrypted database entry</g, '>Entri database terenkripsi<');
content = content.replace(/>Global IPK Kelas</g, '>IPK Kelas Global<');
content = content.replace(/>Live telemetry stream</g, '>Metrik Sesi Aktif<');
content = content.replace(/>Modified object vector</g, '>Perubahan data<');
content = content.replace(/>RESET GLOBAL DATABASE</g, '>RESET DATABASE GLOBAL<');
content = content.replace(/>Legacy Index</g, '>Indeks Lama<');
content = content.replace(/>Review Panel</g, '>Panel Tinjauan<');
content = content.replace(/>Active Spectrum</g, '>Spektrum Aktif<');
content = content.replace(/Unified Spectrum/g, 'Seluruh Kelas');


fs.writeFileSync('src/pages/DashboardTeacher.tsx', content, 'utf8');

let stdContent = fs.readFileSync('src/pages/DashboardStudent.tsx', 'utf8');
stdContent = stdContent.replace(/>Student Portal</g, '>Portal Siswa<');
stdContent = stdContent.replace(/>Navigation</g, '>Navigasi<');
stdContent = stdContent.replace(/>Login Session</g, '>Sesi Masuk<');
stdContent = stdContent.replace(/>Due: Today</g, '>Tenggat: Hari Ini<');
stdContent = stdContent.replace(/>Incentive System</g, '>Sistem Insentif<');
stdContent = stdContent.replace(/>Released</g, '>Diterbitkan<');
stdContent = stdContent.replace(/>Your Score</g, '>Nilai Anda<');
stdContent = stdContent.replace(/>Cancel</g, '>Batal<');

fs.writeFileSync('src/pages/DashboardStudent.tsx', stdContent, 'utf8');
