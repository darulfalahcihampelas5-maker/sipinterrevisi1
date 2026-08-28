const fs = require('fs');

const code = fs.readFileSync('src/pages/DashboardStudent.tsx', 'utf-8');

let tags = [];
let lines = code.split('\n');

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Very naive, just to help me locate tags
}
