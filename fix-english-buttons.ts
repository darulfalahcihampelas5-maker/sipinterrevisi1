import fs from 'fs';

let content = fs.readFileSync('src/pages/DashboardTeacher.tsx', 'utf8');

// Replacements for english texts found in buttons and labels
content = content.replace(/Establish Class/g, 'Buat Kelas Baru');
content = content.replace(/Enrolment/g, 'Pendaftaran');
content = content.replace(/Directory/g, 'Direktori');
content = content.replace(/Filter Access/g, 'Filter Akses');
content = content.replace(/Purge/g, 'Hapus Data');
content = content.replace(/Publish Task/g, 'Buat Tugas');
content = content.replace(/Performance Audit/g, 'Audit Kinerja');
content = content.replace(/Digital Ledger/g, 'Buku Nilai Digital');
content = content.replace(/\+ Add Segment/g, '+ Tambah Target Kelas');
content = content.replace(/Live Sync/g, 'Sinkronisasi Langsung');
content = content.replace(/RESET GLOBAL DATABASE/g, 'RESET BASIS DATA GLOBAL');

fs.writeFileSync('src/pages/DashboardTeacher.tsx', content, 'utf8');
