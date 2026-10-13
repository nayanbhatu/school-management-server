const pool = require('../config/db');

async function inspect() {
  const tables = ['fee_structures', 'fee_installments', 'payments', 'students'];
  for (const t of tables) {
    const cols = await pool.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${t}' ORDER BY ordinal_position`);
    console.log(`=== TABLE: ${t} ===`);
    console.log(JSON.stringify(cols.rows, null, 2));
  }
  
  const constraints = await pool.query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.table_name IN ('fee_structures', 'fee_installments', 'payments')
    ORDER BY tc.table_name, tc.constraint_name
  `);
  console.log('=== CONSTRAINTS ===');
  console.log(JSON.stringify(constraints.rows, null, 2));

  const checkConstraints = await pool.query(`
    SELECT relname, conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    WHERE r.relname IN ('fee_structures', 'fee_installments', 'payments') AND c.contype = 'c'
  `);
  console.log('=== CHECK CONSTRAINTS ===');
  console.log(JSON.stringify(checkConstraints.rows, null, 2));

  // Inspect existing payments
  const payments = await pool.query('SELECT * FROM payments');
  console.log('=== EXISTING PAYMENTS ===');
  console.log(JSON.stringify(payments.rows, null, 2));

  await pool.end();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
