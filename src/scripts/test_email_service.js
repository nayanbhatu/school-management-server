require('dotenv').config();
const emailService = require('../services/email.service');

async function runEmailTests() {
  console.log('--- STARTING EMAIL SERVICE & SMTP CONFIGURATION TESTS ---');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Synthetic domain check
    assert(emailService.isSyntheticEmail('parent@example.com') === true, 'isSyntheticEmail identifies @example.com');
    assert(emailService.isSyntheticEmail('parent@sub.example.com') === true, 'isSyntheticEmail identifies subdomains of example.com');
    assert(emailService.isSyntheticEmail('parent@example.org') === true, 'isSyntheticEmail identifies @example.org');
    assert(emailService.isSyntheticEmail('parent@realmail.org') === false, 'isSyntheticEmail allows legitimate domains');

    // 2. Email format validation & typo checks
    const { validateEmail } = require('../utils/validators');
    assert(emailService.isValidEmailFormat('user@school.com') === true, 'isValidEmailFormat accepts valid standard email');
    assert(emailService.isValidEmailFormat('name@gmail.com') === true, 'isValidEmailFormat accepts name@gmail.com');
    assert(emailService.isValidEmailFormat('name@example.in') === true, 'isValidEmailFormat accepts name@example.in (.in TLD)');
    assert(emailService.isValidEmailFormat('student@subdomain.school.edu') === true, 'isValidEmailFormat accepts educational subdomains');
    assert(emailService.isValidEmailFormat('founder@tech.co') === true, 'isValidEmailFormat accepts legitimate .co domain');
    assert(emailService.isValidEmailFormat('admin@portal.gov.in') === true, 'isValidEmailFormat accepts multi-part country code TLDs');
    
    // Typo rejections
    assert(emailService.isValidEmailFormat('nandev160@gmail.comm') === false, 'isValidEmailFormat rejects .comm typo');
    assert(emailService.isValidEmailFormat('parent@domain.cmo') === false, 'isValidEmailFormat rejects .cmo typo');
    assert(emailService.isValidEmailFormat('parent@domain.con') === false, 'isValidEmailFormat rejects .con typo');
    assert(emailService.isValidEmailFormat('parent@domain.coom') === false, 'isValidEmailFormat rejects .coom typo');
    assert(emailService.isValidEmailFormat('parent@domain.nett') === false, 'isValidEmailFormat rejects .nett typo');
    assert(emailService.isValidEmailFormat('parent@domain.orgg') === false, 'isValidEmailFormat rejects .orgg typo');
    assert(emailService.isValidEmailFormat('parent@gamil.com') === false, 'isValidEmailFormat rejects @gamil.com typo');
    assert(emailService.isValidEmailFormat('parent@example.com145') === false, 'isValidEmailFormat rejects numeric TLD (.com145)');
    assert(emailService.isValidEmailFormat('not-an-email') === false, 'isValidEmailFormat rejects string without @');
    assert(emailService.isValidEmailFormat('') === false, 'isValidEmailFormat rejects empty string');
    assert(emailService.isValidEmailFormat('user@') === false, 'isValidEmailFormat rejects missing domain');
    assert(emailService.isValidEmailFormat('@domain.com') === false, 'isValidEmailFormat rejects missing local part');
    assert(emailService.isValidEmailFormat('user..name@domain.com') === false, 'isValidEmailFormat rejects consecutive dots');

    // validateEmail helper details test
    const commDetail = validateEmail('nandev160@gmail.comm');
    assert(commDetail.isValid === false && commDetail.message.includes('typo'), 'validateEmail provides explicit typo message for .comm');
    const validNorm = validateEmail('  Parent@Domain.COM  ');
    assert(validNorm.isValid === true && validNorm.normalized === 'Parent@domain.com', 'validateEmail trims whitespace and normalizes domain casing');

    // 3. SMTP configuration inspection
    const currentConfig = emailService.getSmtpConfig();
    assert(currentConfig.host === 'smtp.gmail.com', `Default host is smtp.gmail.com (got: ${currentConfig.host})`);
    assert(currentConfig.port === 587, `Default port is 587 (got: ${currentConfig.port})`);
    assert(currentConfig.secure === false, 'Default secure flag is false (STARTTLS mode on port 587)');
    assert(currentConfig.fromName === 'School Management System', `Configured sender name is School Management System (got: ${currentConfig.fromName})`);

    // 4. Missing credentials fallback behavior (when SMTP_USER / SMTP_PASS are empty)
    emailService.setTestTransporter(null);
    const savedUser = process.env.SMTP_USER;
    const savedPass = process.env.SMTP_PASS;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const simulatedResult = await emailService.sendDecisionEmail({
      recipientEmail: 'parent.legit@actualdomain.org',
      recipientName: 'Jane Doe',
      studentName: 'Bobby Doe',
      status: 'APPROVED',
      targetClassName: 'Class 1'
    });
    if (savedUser) process.env.SMTP_USER = savedUser;
    if (savedPass) process.env.SMTP_PASS = savedPass;
    assert(
      simulatedResult.sent === false &&
      simulatedResult.mode === 'simulated' &&
      simulatedResult.reason === 'smtp_not_configured',
      'Unconfigured SMTP safely falls back to simulated mode with sent: false and mode: simulated'
    );

    // 5. Invalid recipient validation
    const invalidRecipientResult = await emailService.sendDecisionEmail({
      recipientEmail: 'invalid-email-address',
      studentName: 'Bobby Doe',
      status: 'APPROVED'
    });
    assert(
      invalidRecipientResult.sent === false &&
      invalidRecipientResult.mode === 'skipped' &&
      invalidRecipientResult.reason === 'missing_or_invalid_recipient',
      'Invalid recipient format returns mode: skipped'
    );

    // 6. Synthetic email suppression
    const syntheticResult = await emailService.sendDecisionEmail({
      recipientEmail: 'test.parent@example.com',
      studentName: 'Bobby Doe',
      status: 'APPROVED'
    });
    assert(
      syntheticResult.sent === false &&
      syntheticResult.mode === 'suppressed' &&
      syntheticResult.reason === 'synthetic_example_domain',
      'Synthetic test domains return mode: suppressed'
    );

    // 7. Mocked SMTP delivery success (testing email sending logic offline)
    let capturedMailOptions = null;
    const mockSuccessTransporter = {
      sendMail: async (options) => {
        capturedMailOptions = options;
        return {
          messageId: '<test-msg-uuid-12345@gmail.com>',
          accepted: [options.to],
          response: '250 2.0.0 OK'
        };
      },
      verify: async () => true
    };

    emailService.setTestTransporter(mockSuccessTransporter);

    const deliveryResult = await emailService.sendDecisionEmail({
      recipientEmail: 'parent.legit@actualdomain.org',
      recipientName: 'Jane Doe',
      studentName: 'Bobby Doe',
      status: 'APPROVED',
      targetClassName: 'Class 1'
    });

    assert(
      deliveryResult.sent === true &&
      deliveryResult.mode === 'delivered' &&
      deliveryResult.messageId === '<test-msg-uuid-12345@gmail.com>',
      'Configured SMTP successfully delivers email via transporter returning sent: true and messageId'
    );
    assert(
      capturedMailOptions &&
      capturedMailOptions.to === 'parent.legit@actualdomain.org' &&
      capturedMailOptions.subject.includes('Bobby Doe') &&
      capturedMailOptions.subject.includes('Approved') &&
      capturedMailOptions.text.includes('APPROVED') &&
      capturedMailOptions.text.includes('Class 1'),
      'Captured mail options include correct recipient, subject, and approved text body'
    );

    // 8. Rejection email formatting check
    const rejectDeliveryResult = await emailService.sendDecisionEmail({
      recipientEmail: 'parent.legit@actualdomain.org',
      recipientName: 'Jane Doe',
      studentName: 'Bobby Doe',
      status: 'REJECTED'
    });
    assert(
      rejectDeliveryResult.sent === true &&
      capturedMailOptions.text.includes('was not approved at this time'),
      'Rejection notification includes regret messaging'
    );

    // 9. Mocked SMTP delivery failure (testing error resilience)
    const mockFailureTransporter = {
      sendMail: async () => {
        throw new Error('535-5.7.8 Username and Password not accepted');
      },
      verify: async () => {
        throw new Error('535-5.7.8 Username and Password not accepted');
      }
    };

    emailService.setTestTransporter(mockFailureTransporter);

    const failureResult = await emailService.sendDecisionEmail({
      recipientEmail: 'parent.legit@actualdomain.org',
      recipientName: 'Jane Doe',
      studentName: 'Bobby Doe',
      status: 'APPROVED'
    });

    assert(
      failureResult.sent === false &&
      failureResult.mode === 'failed' &&
      failureResult.error.includes('535-5.7.8'),
      'SMTP authentication failure is caught gracefully without unhandled exception'
    );

    // 10. verifySmtpConnection check
    emailService.setTestTransporter(mockSuccessTransporter);
    const verifySuccess = await emailService.verifySmtpConnection();
    assert(verifySuccess.connected === true, 'verifySmtpConnection returns connected: true for valid transport');

    emailService.setTestTransporter(mockFailureTransporter);
    const verifyFailure = await emailService.verifySmtpConnection();
    assert(verifyFailure.connected === false && Boolean(verifyFailure.error), 'verifySmtpConnection returns connected: false on error');

  } catch (err) {
    console.error('Unexpected error during email tests:', err);
    failed++;
  } finally {
    // Teardown: clear test transporter
    emailService.setTestTransporter(null);
  }

  console.log(`\n========================================`);
  console.log(`EMAIL SERVICE TESTS COMPLETE:`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runEmailTests();
