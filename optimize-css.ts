import fs from 'fs';
import path from 'path';

function processFile(filePath: string) {
  let content = fs.readFileSync(filePath, 'utf8');
  let newContent = content;

  // Replace heavy shadows with lighter ones
  newContent = newContent.replace(/shadow-2xl/g, 'shadow-md');
  newContent = newContent.replace(/shadow-xl/g, 'shadow-sm');
  
  // Remove backdrop blurs
  newContent = newContent.replace(/backdrop-blur(-\w+)?/g, '');

  // Simplify transitions
  newContent = newContent.replace(/duration-1000/g, 'duration-300');
  newContent = newContent.replace(/duration-700/g, 'duration-300');
  newContent = newContent.replace(/animate-in zoom-in-\d+/g, '');
  newContent = newContent.replace(/animate-pulse/g, '');
  
  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`Optimized ${filePath}`);
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
