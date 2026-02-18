const fs = require('fs');
const content = fs.readFileSync('prisma/seed.ts', 'utf8');

let i = 0;
let lineNum = 1;
let colNum = 1;

while (i < content.length) {
  const ch = content[i];

  // Track line/col for CRLF
  if (ch === '\r' && content[i + 1] === '\n') {
    lineNum++; colNum = 1; i += 2; continue;
  } else if (ch === '\n' || ch === '\r') {
    lineNum++; colNum = 1; i++; continue;
  }

  // Skip line comments
  if (ch === '/' && content[i + 1] === '/') {
    while (i < content.length && content[i] !== '\n' && content[i] !== '\r') { i++; colNum++; }
    continue;
  }

  // Skip block comments
  if (ch === '/' && content[i + 1] === '*') {
    i += 2; colNum += 2;
    while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
      if (content[i] === '\n' || content[i] === '\r') { lineNum++; colNum = 1; }
      else colNum++;
      i++;
    }
    i += 2; colNum += 2;
    continue;
  }

  // Check for template literals
  if (ch === '`') {
    i++; colNum++;
    while (i < content.length && content[i] !== '`') {
      if (content[i] === '\\') { i += 2; colNum += 2; continue; }
      if (content[i] === '\n') { lineNum++; colNum = 1; }
      else colNum++;
      i++;
    }
    i++; colNum++;
    continue;
  }

  // Check for string literals
  if (ch === "'" || ch === '"') {
    const quote = ch;
    const startLine = lineNum;
    const startCol = colNum;
    i++; colNum++;
    while (i < content.length) {
      const c = content[i];
      if (c === '\\') { i += 2; colNum += 2; continue; }
      if (c === quote) { i++; colNum++; break; }
      if (c === '\n' || c === '\r') {
        // Unterminated string!
        const lineContent = content.split('\n')[startLine - 1];
        console.log('UNTERMINATED string started at line', startLine, 'col', startCol);
        console.log('  Quote char: U+' + quote.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
        console.log('  Line content:', JSON.stringify(lineContent ? lineContent.substring(0, 120) : ''));
        break;
      }
      i++; colNum++;
    }
    continue;
  }

  i++; colNum++;
}

console.log('Done scanning.');
