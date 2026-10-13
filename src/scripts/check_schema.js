const pool = require('../config/db');

async function check() {
  try {
    const uCols = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position
    `);
    console.log('users columns:', JSON.stringify(uCols.rows, null, 2));

    const tCols = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'teachers' 
      ORDER BY ordinal_position
    `);
    console.log('teachers columns:', JSON.stringify(tCols.rows, null, 2));

    const users = await pool.query('SELECT id, username, role, created_at FROM users');
    console.log('users:', JSON.stringify(users.rows, null, 2));

    const teachers = await pool.query('SELECT * FROM teachers');
    console.log('teachers:', JSON.stringify(teachers.rows, null, 2));
  } catch (err) {
    console.error('Error checking schema:', err);
  } finally {
    await pool.end();
  }
}

check();
