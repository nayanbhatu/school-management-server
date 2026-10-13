/**
 * setup_db.js
 *
 * INITIAL DEVELOPMENT DATABASE INITIALIZATION SCRIPT
 *
 * Note: This script is intended strictly for initial development setup on an empty database.
 * If executed against an already-populated database, it detects existing records and aborts
 * safely without altering, duplicating, or resetting any data.
 *
 * Developer instructions:
 * - Fresh setup: Point DB_* environment variables in .env to an empty PostgreSQL database,
 *   then run: node src/scripts/setup_db.js
 * - Existing database schema updates: Run: node src/scripts/migrate_schema.js
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');

async function setupDB() {
  const client = await pool.connect();
  try {
    // Detect if database is already populated before making any changes
    const checkTable = await client.query("SELECT to_regclass('public.users') as exists");
    if (checkTable.rows[0].exists) {
      const { rows: userCount } = await client.query('SELECT COUNT(*) FROM users');
      if (parseInt(userCount[0].count, 10) > 0) {
        console.warn('======================================================================');
        console.warn('NOTICE: Database is already initialized and populated with data.');
        console.warn('Aborting setup_db.js to prevent duplicate records or data overwrites.');
        console.warn('To apply migrations to an existing database, run:');
        console.warn('  node src/scripts/migrate_schema.js');
        console.warn('setup_db.js is intended strictly for initial setup on an empty database.');
        console.warn('======================================================================');
        return;
      }
    }

    await client.query('BEGIN');
    console.log('Starting DB setup...');

    // 1. users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'teacher')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. teachers
    await client.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. classes
    await client.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        level INTEGER NOT NULL CHECK (level > 0)
      )
    `);

    // 4. sections
    await client.query(`
      CREATE TABLE IF NOT EXISTS sections (
        id SERIAL PRIMARY KEY,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        name VARCHAR(10) NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 25 CHECK (capacity BETWEEN 1 AND 25),
        UNIQUE(class_id, name)
      )
    `);

    // 5. subjects
    await client.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL
      )
    `);

    // 6. teacher_assignments
    await client.query(`
      CREATE TABLE IF NOT EXISTS teacher_assignments (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        UNIQUE(teacher_id, section_id, subject_id)
      )
    `);

    // 7. admission_applications
    await client.query(`
      CREATE TABLE IF NOT EXISTS admission_applications (
        id SERIAL PRIMARY KEY,
        student_first_name VARCHAR(100) NOT NULL,
        student_last_name VARCHAR(100) NOT NULL,
        date_of_birth DATE NOT NULL,
        target_class_id INTEGER NOT NULL REFERENCES classes(id),
        parent_name VARCHAR(150),
        parent_email VARCHAR(150),
        parent_phone VARCHAR(20),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 8. students
    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        application_id INTEGER UNIQUE NOT NULL REFERENCES admission_applications(id),
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        date_of_birth DATE NOT NULL,
        section_id INTEGER NOT NULL REFERENCES sections(id),
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 9. fee_structures
    await client.query(`
      CREATE TABLE IF NOT EXISTS fee_structures (
        id SERIAL PRIMARY KEY,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        academic_year VARCHAR(20) NOT NULL,
        annual_fee NUMERIC(10, 2) NOT NULL CHECK (annual_fee > 0),
        UNIQUE(class_id, academic_year)
      )
    `);

    // 10. fee_installments
    await client.query(`
      CREATE TABLE IF NOT EXISTS fee_installments (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        fee_structure_id INTEGER NOT NULL REFERENCES fee_structures(id),
        installment_number INTEGER NOT NULL CHECK (installment_number BETWEEN 1 AND 4),
        amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID')),
        due_date DATE NOT NULL,
        UNIQUE(student_id, fee_structure_id, installment_number)
      )
    `);

    // 11. payments
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        installment_id INTEGER UNIQUE NOT NULL REFERENCES fee_installments(id) ON DELETE CASCADE,
        amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid > 0),
        payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        receipt_number VARCHAR(50) UNIQUE NOT NULL,
        payment_method VARCHAR(50) NOT NULL DEFAULT 'Cash' CHECK (payment_method IN ('Cash', 'Cheque', 'Bank Transfer', 'UPI', 'Card')),
        reference_number VARCHAR(100),
        remarks TEXT
      )
    `);

    console.log('Tables created successfully.');

    // Seed Data
    const passwordHash = await bcrypt.hash('password123', 10);

    // Seed Admin
    await client.query(`
      INSERT INTO users (username, password_hash, role)
      VALUES ('admin', $1, 'admin')
      ON CONFLICT (username) DO NOTHING
    `, [passwordHash]);

    // Seed Teachers
    for (let i = 1; i <= 3; i++) {
      await client.query(`
        INSERT INTO users (username, password_hash, role)
        VALUES ($1, $2, 'teacher')
        ON CONFLICT (username) DO NOTHING
      `, [`teacher${i}`, passwordHash]);
    }

    const { rows: teachersRows } = await client.query("SELECT id, username FROM users WHERE role = 'teacher'");
    for (const t of teachersRows) {
      await client.query(`
        INSERT INTO teachers (user_id, first_name, last_name, email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO NOTHING
      `, [t.id, t.username, 'Doe', `${t.username}@school.com`]);
    }

    // Seed Classes and Sections
    const classLevels = [1, 2, 3, 4, 5];
    for (const level of classLevels) {
      await client.query(`
        INSERT INTO classes (name, level)
        VALUES ($1, $2)
        ON CONFLICT (name) DO NOTHING
      `, [`Class ${level}`, level]);
    }

    const { rows: classes } = await client.query('SELECT id, name FROM classes');
    for (const cls of classes) {
      for (const sec of ['A', 'B']) {
        await client.query(`
          INSERT INTO sections (class_id, name)
          VALUES ($1, $2)
          ON CONFLICT (class_id, name) DO NOTHING
        `, [cls.id, sec]);
      }
      
      // Fee structures
      await client.query(`
        INSERT INTO fee_structures (class_id, academic_year, annual_fee)
        VALUES ($1, '2023-2024', $2)
        ON CONFLICT (class_id, academic_year) DO NOTHING
      `, [cls.id, 30000 + (cls.id * 1000)]);
    }

    // Subjects
    const subjects = ['English', 'Mathematics', 'Science', 'Gujarati', 'Computer'];
    for (const sub of subjects) {
      await client.query(`
        INSERT INTO subjects (name)
        VALUES ($1)
        ON CONFLICT (name) DO NOTHING
      `, [sub]);
    }

    const { rows: allTeachers } = await client.query('SELECT id FROM teachers');
    const { rows: allSections } = await client.query('SELECT id FROM sections');
    const { rows: allSubjects } = await client.query('SELECT id FROM subjects');

    if (allTeachers.length > 0 && allSections.length > 0 && allSubjects.length > 0) {
      await client.query(`
        INSERT INTO teacher_assignments (teacher_id, section_id, subject_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [allTeachers[0].id, allSections[0].id, allSubjects[0].id]);
    }

    // Admission Applications
    const statuses = ['PENDING', 'APPROVED', 'REJECTED'];
    for (let i = 1; i <= 10; i++) {
      await client.query(`
        INSERT INTO admission_applications (
          student_first_name, student_last_name, date_of_birth, target_class_id, status,
          parent_name, parent_email, parent_phone
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        `StudentFirst${i}`, 
        `StudentLast${i}`, 
        '2015-01-01', 
        classes[0].id, 
        statuses[i%3],
        `Parent of StudentFirst${i} StudentLast${i}`,
        `studentfirst${i}.parent@example.com`,
        `555-010${i}`
      ]);
    }

    // Enroll APPROVED applications
    const { rows: approvedApps } = await client.query("SELECT * FROM admission_applications WHERE status = 'APPROVED'");
    for (const app of approvedApps) {
      const result = await client.query(`
        INSERT INTO students (application_id, first_name, last_name, date_of_birth, section_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [app.id, app.student_first_name, app.student_last_name, app.date_of_birth, allSections[0].id]);
      
      const studentId = result.rows[0].id;
      const { rows: feeStruct } = await client.query('SELECT id, annual_fee FROM fee_structures WHERE class_id = $1 LIMIT 1', [app.target_class_id]);
      
      if (feeStruct.length > 0) {
        const amount = feeStruct[0].annual_fee / 4;
        for (let i = 1; i <= 4; i++) {
          const month = 3 + i * 2;
          const monthStr = month < 10 ? `0${month}` : `${month}`;
          await client.query(`
            INSERT INTO fee_installments (student_id, fee_structure_id, installment_number, amount, status, due_date)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (student_id, fee_structure_id, installment_number) DO NOTHING
          `, [studentId, feeStruct[0].id, i, amount, i === 1 ? 'PAID' : 'PENDING', `2023-${monthStr}-01`]);
        }
      }
    }

    // Payments for PAID installments
    const { rows: paidInstallments } = await client.query("SELECT id, amount FROM fee_installments WHERE status = 'PAID'");
    for (let i = 0; i < paidInstallments.length; i++) {
      const inst = paidInstallments[i];
      await client.query(`
        INSERT INTO payments (installment_id, amount_paid, receipt_number, payment_method, reference_number, remarks)
        VALUES ($1, $2, $3, 'Cash', $4, 'Initial seed payment')
        ON CONFLICT (receipt_number) DO NOTHING
      `, [inst.id, inst.amount, `REC-${Date.now()}-${i}`, `REF-SEED-${i + 1}`]);
    }

    await client.query('COMMIT');
    console.log('Database seeded successfully.');

    // Verifications
    const tables = ['users', 'teachers', 'classes', 'sections', 'subjects', 'teacher_assignments', 'admission_applications', 'students', 'fee_structures', 'fee_installments', 'payments'];
    
    console.log('\\n--- VERIFICATION RESULTS ---');
    for (const table of tables) {
      const res = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`${table}: ${res.rows[0].count} records`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during setup:', err);
  } finally {
    client.release();
    pool.end();
  }
}

setupDB();
