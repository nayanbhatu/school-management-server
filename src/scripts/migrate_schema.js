const pool = require('../config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Beginning schema migration within a single transaction...');
    await client.query('BEGIN');

    // 1. ADMISSION_APPLICATIONS
    console.log('1. Migrating admission_applications...');
    await client.query(`
      ALTER TABLE admission_applications 
        ADD COLUMN IF NOT EXISTS parent_name VARCHAR(150),
        ADD COLUMN IF NOT EXISTS parent_email VARCHAR(150),
        ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(20);
    `);

    // Backfill existing seed records if parent_email is null
    await client.query(`
      UPDATE admission_applications 
      SET parent_name = 'Parent of ' || student_first_name || ' ' || student_last_name,
          parent_email = LOWER(student_first_name) || '.parent@example.com',
          parent_phone = '555-010' || id
      WHERE parent_email IS NULL;
    `);

    await client.query(`
      ALTER TABLE admission_applications 
        ALTER COLUMN target_class_id SET NOT NULL,
        ALTER COLUMN status SET NOT NULL;
    `);

    // 2. TEACHERS
    console.log('2. Migrating teachers...');
    await client.query(`
      ALTER TABLE teachers 
        ALTER COLUMN user_id SET NOT NULL;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_user_id_key') THEN
          ALTER TABLE teachers ADD CONSTRAINT teachers_user_id_key UNIQUE (user_id);
        END IF;
      END $$;
    `);

    // 3. CLASSES
    console.log('3. Migrating classes...');
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_level_check') THEN
          ALTER TABLE classes ADD CONSTRAINT classes_level_check CHECK (level > 0);
        END IF;
      END $$;
    `);

    // 4. SECTIONS
    console.log('4. Migrating sections...');
    await client.query(`
      ALTER TABLE sections 
        ALTER COLUMN class_id SET NOT NULL,
        ALTER COLUMN capacity SET NOT NULL;
    `);

    await client.query(`
      ALTER TABLE sections 
        DROP CONSTRAINT IF EXISTS sections_capacity_check;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sections_capacity_check') THEN
          ALTER TABLE sections ADD CONSTRAINT sections_capacity_check CHECK (capacity BETWEEN 1 AND 25);
        END IF;
      END $$;
    `);

    // 5. TEACHER_ASSIGNMENTS
    console.log('5. Migrating teacher_assignments...');
    await client.query(`
      ALTER TABLE teacher_assignments 
        ALTER COLUMN teacher_id SET NOT NULL,
        ALTER COLUMN section_id SET NOT NULL,
        ALTER COLUMN subject_id SET NOT NULL;
    `);

    // 6. STUDENTS
    console.log('6. Migrating students...');
    await client.query(`
      ALTER TABLE students 
        ALTER COLUMN application_id SET NOT NULL,
        ALTER COLUMN section_id SET NOT NULL;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_application_id_key') THEN
          ALTER TABLE students ADD CONSTRAINT students_application_id_key UNIQUE (application_id);
        END IF;
      END $$;
    `);

    // 7. FEE_STRUCTURES
    console.log('7. Migrating fee_structures...');
    await client.query(`
      ALTER TABLE fee_structures 
        ALTER COLUMN class_id SET NOT NULL;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_structures_annual_fee_check') THEN
          ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_annual_fee_check CHECK (annual_fee > 0);
        END IF;
      END $$;
    `);

    // 8. FEE_INSTALLMENTS
    console.log('8. Migrating fee_installments...');
    await client.query(`
      ALTER TABLE fee_installments 
        ALTER COLUMN student_id SET NOT NULL,
        ALTER COLUMN fee_structure_id SET NOT NULL,
        ALTER COLUMN installment_number SET NOT NULL,
        ALTER COLUMN status SET NOT NULL;
    `);

    // Replace UNIQUE (student_id, installment_number) with UNIQUE (student_id, fee_structure_id, installment_number)
    await client.query(`
      ALTER TABLE fee_installments 
        DROP CONSTRAINT IF EXISTS fee_installments_student_id_installment_number_key;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_installments_student_fee_struct_inst_key') THEN
          ALTER TABLE fee_installments ADD CONSTRAINT fee_installments_student_fee_struct_inst_key 
            UNIQUE (student_id, fee_structure_id, installment_number);
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fee_installments_amount_check') THEN
          ALTER TABLE fee_installments ADD CONSTRAINT fee_installments_amount_check CHECK (amount > 0);
        END IF;
      END $$;
    `);

    // 9. PAYMENTS
    console.log('9. Migrating payments...');
    await client.query(`
      ALTER TABLE payments 
        ALTER COLUMN installment_id SET NOT NULL;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_installment_id_key') THEN
          ALTER TABLE payments ADD CONSTRAINT payments_installment_id_key UNIQUE (installment_id);
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_paid_check') THEN
          ALTER TABLE payments ADD CONSTRAINT payments_amount_paid_check CHECK (amount_paid > 0);
        END IF;
      END $$;
    `);

    await client.query(`
      ALTER TABLE payments 
        ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Cash' NOT NULL,
        ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100),
        ADD COLUMN IF NOT EXISTS remarks TEXT;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_payment_method_check') THEN
          ALTER TABLE payments ADD CONSTRAINT payments_payment_method_check 
            CHECK (payment_method IN ('Cash', 'Cheque', 'Bank Transfer', 'UPI', 'Card'));
        END IF;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('Schema migration applied and committed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back successfully:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
