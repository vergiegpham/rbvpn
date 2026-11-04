/**
 * Set package.json version from today's date:
 *   (year - 2020).(month).(day)
 * Example: 2026-10-07 → 6.10.7
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;
const day = now.getDate();
const version = `${year - 2020}.${month}.${day}`;

pkg.version = version;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`Client version set to ${version} (from ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')})`);
