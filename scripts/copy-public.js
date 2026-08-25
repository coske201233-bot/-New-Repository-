const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const distDir = path.join(__dirname, '..', 'dist');

if (fs.existsSync(publicDir) && fs.existsSync(distDir)) {
  const files = fs.readdirSync(publicDir);
  for (const file of files) {
    if (file === 'index.html') continue; // index.html is bundled by Expo export
    const srcPath = path.join(publicDir, file);
    const destPath = path.join(distDir, file);
    fs.copyFileSync(srcPath, destPath);
    console.log(`✅ Copied ${file} to dist/`);
  }
}
