function decodeWindTemp(val) {
  if (!val || val.length < 4) return null;
  const dd = parseInt(val.slice(0, 2), 10);
  const ss = parseInt(val.slice(2, 4), 10);
  
  if (dd === 99 && ss === 0) {
    const tStr = val.slice(4);
    let temp = null;
    if (tStr) {
      if (tStr.startsWith('+') || tStr.startsWith('-')) temp = parseInt(tStr, 10);
      else temp = -parseInt(tStr, 10);
    }
    return { direction: null, speed: 0, temp };
  }
  
  let dir = dd * 10;
  let speed = ss;
  if (dd >= 51 && dd <= 86) {
    dir = (dd - 50) * 10;
    speed += 100;
  }
  
  let temp = null;
  if (val.length > 4) {
    const tStr = val.slice(4);
    if (tStr.startsWith('+') || tStr.startsWith('-')) {
      temp = parseInt(tStr, 10);
    } else {
      temp = -parseInt(tStr, 10);
    }
  }
  return { direction: dir, speed, temp };
}

console.log(decodeWindTemp("2120+20")); // 210, 20, 20
console.log(decodeWindTemp("9900+17")); // null, 0, 17
console.log(decodeWindTemp("2720-14")); // 270, 20, -14
console.log(decodeWindTemp("273130")); // 270, 31, -30
console.log(decodeWindTemp("774047")); // 77 -> 270, 140, -47
console.log(decodeWindTemp("3422")); // 340, 22, null
