// Fails when a Vitest JSON report holds no passed test or any skipped one. CI runs it on the database tests,
// because they skip on purpose when DATABASE_MIGRATE_URL is unset and a skip in CI would hide a missing service.
//   npx vitest run <file> --reporter=json --outputFile=report.json && node scripts/check-tests-ran.mjs report.json
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/check-tests-ran.mjs <vitest-json-report>');
const report = JSON.parse(readFileSync(file, 'utf8'));

const problems = [];
if (report.numFailedTests > 0) problems.push(`${report.numFailedTests} test(s) failed`);
if (report.numPendingTests > 0 || report.numTodoTests > 0) {
  problems.push(`${report.numPendingTests + report.numTodoTests} test(s) were skipped or todo`);
}
if (report.numPassedTests === 0) problems.push('no test passed');

if (problems.length > 0) {
  console.error(`check-tests-ran: ${problems.join('; ')} in ${file}. Is DATABASE_MIGRATE_URL set and Postgres reachable?`);
  process.exit(1);
}
console.log(`check-tests-ran: ${report.numPassedTests} passed, none skipped (${file})`);
