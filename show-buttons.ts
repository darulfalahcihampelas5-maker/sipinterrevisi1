import fs from 'fs';

const files = [
  'src/pages/LoginPage.tsx',
  'src/pages/DashboardStudent.tsx',
  'src/pages/DashboardTeacher.tsx',
];

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  console.log(`\n\n--- ${f} ---`);
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('<button') || line.includes('</button>')) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length - 1, i + 2);
      for (let j = start; j <= end; j++) {
        console.log(`${j + 1}: ${lines[j]}`);
      }
      console.log('---');
    }
  }
}
