import fs from 'fs';
import path from 'path';

function processFile(filePath: string) {
  let content = fs.readFileSync(filePath, 'utf8');
  let newContent = content;

  // Remove blur blobs and transition-all
  newContent = newContent.replace(/blur-\w+/g, '');
  newContent = newContent.replace(/transition-all/g, ''); // Can cause jank on some transforms
  newContent = newContent.replace(/animate-in slide-in-from-bottom-\d+ duration-\d+/g, '');
  newContent = newContent.replace(/fade-in/g, '');
  
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`Optimized more in ${filePath}`);
  }
}

function processDir(dirPath: string) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      processFile(fullPath);
    }
  }
}

processDir(path.join(process.cwd(), 'src'));
