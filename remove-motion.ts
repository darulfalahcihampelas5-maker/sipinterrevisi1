import fs from 'fs';
import path from 'path';

function processFile(filePath: string) {
  let content = fs.readFileSync(filePath, 'utf8');
  let newContent = content;

  // Remove Framer Motion attributes and change tags
  newContent = newContent.replace(/<motion\.div[^>]*>/g, '<div>');
  newContent = newContent.replace(/<\/motion\.div>/g, '</div>');
  newContent = newContent.replace(/<AnimatePresence[^>]*>/g, '<>');
  newContent = newContent.replace(/<\/AnimatePresence>/g, '</>');
  
  // Remove motion import
  newContent = newContent.replace(/import \{.*motion.*\} from 'framer-motion';\n/g, '');
  newContent = newContent.replace(/import \{.*motion.*\} from 'motion\/react';\n/g, '');

  if (content !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`Removed motion from ${filePath}`);
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
