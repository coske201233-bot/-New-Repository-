const fs = require('fs');
const content = fs.readFileSync('src/utils/shiftEngine.ts', 'utf8');

function checkBraces(code) {
  let depth = 0;
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === '{') depth++;
      if (char === '}') depth--;
    }
    console.log(`${i + 1}: ${depth} | ${line.substring(0, 50)}`);
  }
}

checkBraces(content);
