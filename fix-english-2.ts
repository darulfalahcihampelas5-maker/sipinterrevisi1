import fs from 'fs';

let content = fs.readFileSync('src/pages/DashboardTeacher.tsx', 'utf8');

// Replacements
content = content.replace(/Unit Assignment/g, 'Modul Tugas');
content = content.replace(/Support: \.XLSX, \.CSV and \.XLS/g, 'Format didukung: .XLSX dan .XLS');
content = content.replace(/ARCHIVED CONTENT/g, 'KONTEN DIARSIPKAN');

fs.writeFileSync('src/pages/DashboardTeacher.tsx', content, 'utf8');
