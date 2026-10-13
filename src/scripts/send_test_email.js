require('dotenv').config();
const emailService = require('../services/email.service');

async function main() {
  const recipient = process.argv[2];

  console.log('====================================================');
  console.log('   Gmail SMTP Verification & Manual Test Tool');
  console.log('====================================================\n');

  const config = emailService.getSmtpConfig();

  console.log('1. Checking Loaded SMTP Configuration:');
  console.log(`   - SMTP_HOST:       ${config.host}`);
  console.log(`   - SMTP_PORT:       ${config.port}`);
  console.log(`   - SMTP_SECURE:     ${config.secure} (STARTTLS mode on port 587)`);
  console.log(`   - SMTP_USER:       ${config.user ? config.user.replace(/(?<=^.).+(?=@)/, '***') : '[NOT SET - BLANK]'}`);
  console.log(`   - SMTP_PASS:       ${config.pass ? '******** (configured)' : '[NOT SET - BLANK]'}`);
  console.log(`   - EMAIL_FROM:      ${config.fromAddress || '[defaults to SMTP_USER]'}`);
  console.log(`   - EMAIL_FROM_NAME: ${config.fromName}\n`);

  if (!config.isConfigured) {
    console.warn('⚠️  SMTP credentials are not yet configured in server/.env.');
    console.warn('   To enable real Gmail sending, please add your credentials to server/.env:');
    console.warn('     SMTP_USER=your_email@gmail.com');
    console.warn('     SMTP_PASS=your_16_character_app_password\n');
    console.warn('   (Note: Do not commit your credentials to git repository.)\n');
    
    if (!recipient) {
      console.log('Usage: node src/scripts/send_test_email.js <recipient-email>');
      process.exit(0);
    }
  }

  console.log('2. Testing SMTP Connection Handshake (Nodemailer verify)...');
  const verifyResult = await emailService.verifySmtpConnection();

  if (!verifyResult.connected) {
    console.error(`❌ SMTP Connection Failed: ${verifyResult.error || verifyResult.reason}`);
    console.log('\nTroubleshooting tips for Gmail:');
    console.log('1. Ensure 2-Step Verification is turned ON for your Google Account.');
    console.log('2. Generate a dedicated App Password at: https://myaccount.google.com/apppasswords');
    console.log('3. Paste the 16-character App Password (without spaces) into SMTP_PASS in server/.env.');
    console.log('4. Ensure SMTP_HOST=smtp.gmail.com and SMTP_PORT=587 with SMTP_SECURE=false.');
    process.exit(1);
  }

  console.log('✅ SMTP Connection Handshake Successful!\n');

  if (!recipient) {
    console.log('ℹ️  No recipient email provided. Handshake test passed.');
    console.log('   To send a live test message, pass a recipient email address:');
    console.log('   node src/scripts/send_test_email.js your-personal-email@example.org\n');
    process.exit(0);
  }

  console.log(`3. Sending Test Admission Decision Notification to: ${recipient}...`);
  const result = await emailService.sendDecisionEmail({
    recipientEmail: recipient,
    recipientName: 'Valued Parent',
    studentName: 'Alex Smith',
    status: 'APPROVED',
    targetClassName: 'Grade 10'
  });

  console.log('\n4. Delivery Attempt Result:');
  console.log(`   - Status:      ${result.sent ? 'SUCCESS' : 'FAILED / SIMULATED'}`);
  console.log(`   - Mode:        ${result.mode}`);
  if (result.messageId) {
    console.log(`   - Message ID:  ${result.messageId}`);
    console.log('\n✅ The Gmail SMTP server accepted the message for relay!');
    console.log('   Please check the recipient inbox (and spam/junk folder) to confirm receipt.');
  } else {
    console.log(`   - Details:     ${result.reason || result.error || 'N/A'}`);
  }

  console.log('\n====================================================\n');
}

main().catch((err) => {
  console.error('Fatal error running email verification tool:', err.message);
  process.exit(1);
});
