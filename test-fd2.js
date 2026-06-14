const lines = `
FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
ABI      2120+20 9900+17 1208+10 2505-04 2720-14 273130 273740 264052
ABQ              2506+19 3207+11 2812-07 2531-18 254333 256441 257153
ABR 3422 3421+04 3323-01 3422-05 3223-17 0115-29 063141 301346 274047
`.trim().split('\n');

const cols = [
  { alt: 3000, start: 4, end: 9 },
  { alt: 6000, start: 9, end: 17 },
  { alt: 9000, start: 17, end: 25 },
  { alt: 12000, start: 25, end: 33 },
  { alt: 18000, start: 33, end: 41 },
  { alt: 24000, start: 41, end: 49 },
  { alt: 30000, start: 49, end: 56 },
  { alt: 34000, start: 56, end: 63 },
  { alt: 39000, start: 63, end: 70 }
];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  const stn = line.slice(0, 3);
  console.log(stn);
  for (const c of cols) {
    const val = line.slice(c.start, c.end).trim();
    if (val) console.log(`  ${c.alt}: ${val}`);
  }
}
