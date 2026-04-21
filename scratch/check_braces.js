
const fs = require('fs');
const content = fs.readFileSync('src/screens/AdminScreen.tsx', 'utf8');
let stack = [];
let line = 1;
let col = 1;
for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '{') stack.push({line, col});
    if (char === '}') {
        if (stack.length === 0) {
            console.log(`Extra closing brace at ${line}:${col}`);
        } else {
            stack.pop();
        }
    }
    if (char === '\n') {
        line++;
        col = 1;
    } else {
        col++;
    }
}
if (stack.length > 0) {
    stack.forEach(s => console.log(`Unclosed brace starting at ${s.line}:${s.col}`));
} else {
    console.log('Braces are balanced');
}
