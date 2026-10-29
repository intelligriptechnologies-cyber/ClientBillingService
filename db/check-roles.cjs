// Signs in as both runtime roles before the app starts (mirrors the check in deploy/deploy-remote.sh).
const pg = require('pg');
const check = async (name) => {
  const url = process.env[name];
  if (!url) throw new Error(name + ' is not set');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query('SELECT current_user AS role');
  await client.end();
  console.log(name + ' signs in as ' + rows[0].role);
};
check('DATABASE_URL').then(() => check('DATABASE_PLATFORM_URL')).catch((error) => { console.error(error.message); process.exit(1); });
