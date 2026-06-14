const fs = require('fs');
const lines = `
FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
ABI      2120+20 9900+17 1208+10 2505-04 2720-14 273130 273740 264052
ABQ              2506+19 3207+11 2812-07 2531-18 254333 256441 257153
`.trim().split('\n');

const header = lines[0];
const alts = [];
const regex = /\b(\d{4,5})\b/g;
let match;
while ((match = regex.exec(header)) !== null) {
  alts.push({ alt: parseInt(match[1]), start: match.index - 2, end: match.index + 6 });
}

console.log(alts);

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  const stn = line.slice(0, 3);
  console.log(stn);
  for (const a of alts) {
    const val = line.slice(a.start, a.end).trim();
    console.log(`  ${a.alt}: ${val ? val : "N/A"}`);
  }
}
