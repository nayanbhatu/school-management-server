require('dotenv').config();
const pool = require('../config/db');

async function seedAcademicYear() {
  console.log('--- SEEDING ACADEMIC YEAR 2026-2027 FEE STRUCTURES ---');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const classesRes = await client.query('SELECT id, name FROM classes ORDER BY id');
    console.log(`Found ${classesRes.rows.length} classes:`, classesRes.rows.map(c => c.name));

    // Fee amounts corresponding to each class level
    const feesByClass = {
      1: 31000.00,
      2: 32000.00,
      3: 33000.00,
      4: 34000.00,
      5: 35000.00
    };

    for (const cls of classesRes.rows) {
      const fee = feesByClass[cls.id] || 30000.00;
      const res = await client.query(
        `INSERT INTO fee_structures (class_id, academic_year, annual_fee)
         VALUES ($1, '2026-2027', $2)
         ON CONFLICT (class_id, academic_year) DO NOTHING
         RETURNING *`,
        [cls.id, fee]
      );

      if (res.rows.length > 0) {
        console.log(`[CREATED] Class ${cls.name}: 2026-2027 fee structure ID ${res.rows[0].id} (₹${fee})`);
      } else {
        console.log(`[EXISTS] Class ${cls.name}: 2026-2027 fee structure already exists`);
      }
    }

    await client.query('COMMIT');
    console.log('Seeding completed successfully without touching historical records.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during seeding:', err);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

seedAcademicYear().catch((err) => {
  console.error(err);
  process.exit(1);
});
