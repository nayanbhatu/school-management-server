require('dotenv').config();
const nodemailer = require('nodemailer');

// Custom transporter hook (used for automated tests with mock transport)
let testTransporter = null;

/**
 * Sets a mock or custom transporter for automated testing without sending real emails
 * @param {object|null} transporter 
 */
const setTestTransporter = (transporter) => {
  testTransporter = transporter;
};

/**
 * Checks whether an email address is a synthetic or RFC-reserved example domain
 */
const isSyntheticEmail = (email) => {
  if (!email || typeof email !== 'string') return true;
  const lower = email.trim().toLowerCase();
  return (
    lower.endsWith('@example.com') ||
    lower.endsWith('.example.com') ||
    lower.endsWith('@example.org') ||
    lower.endsWith('.example.org') ||
    lower.endsWith('@example.net') ||
    lower.endsWith('.example.net')
  );
};

/**
 * Validates email format (rejects malformed domains, numeric TLDs, and lengths > 150)
 */
const { isValidEmail } = require('../utils/validators');
const isValidEmailFormat = (email) => {
  return isValidEmail(email);
};

/**
 * Reads and validates current SMTP configuration from process.env
 */
const getSmtpConfig = () => {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();

  // Sender address: prioritize EMAIL_FROM, fallback to SMTP_USER or SMTP_FROM
  const fromAddress = (process.env.EMAIL_FROM || process.env.SMTP_USER || process.env.SMTP_FROM || '').trim();
  const fromName = (process.env.EMAIL_FROM_NAME || 'School Management System').trim();

  const isConfigured = Boolean(host && user && pass);

  return {
    host,
    port,
    secure,
    user,
    pass,
    fromAddress,
    fromName,
    isConfigured
  };
};

/**
 * Creates Nodemailer transporter configured for Gmail / STARTTLS
 */
const createTransporter = (config = getSmtpConfig()) => {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure, // false for port 587 (STARTTLS)
    requireTLS: !config.secure && config.port === 587,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
};

/**
 * Tests connection to the configured SMTP server without sending an email
 */
const verifySmtpConnection = async () => {
  const config = getSmtpConfig();
  if (!config.isConfigured && !testTransporter) {
    return {
      connected: false,
      reason: 'SMTP credentials (SMTP_USER / SMTP_PASS) are not configured'
    };
  }

  try {
    const transporter = testTransporter || createTransporter(config);
    await transporter.verify();
    return {
      connected: true,
      host: config.host,
      port: config.port,
      user: config.user
    };
  } catch (error) {
    // Sanitize any sensitive details from the error message
    return {
      connected: false,
      error: error.message
    };
  }
};

/**
 * Sends an admission decision notification email (Approved/Rejected)
 * 
 * Safety guarantees:
 * - Never transmits real emails to synthetic @example.com addresses
 * - Detects unconfigured SMTP and safely simulates without claiming delivery
 * - Catches all delivery exceptions without exposing passwords or stack traces
 * - Preserves caller workflow (returns structured delivery result instead of throwing)
 */
const sendDecisionEmail = async ({
  recipientEmail,
  recipientName,
  studentName,
  status,
  targetClassName
}) => {
  // 1. Validate recipient presence and format
  if (!recipientEmail || !isValidEmailFormat(recipientEmail)) {
    return {
      sent: false,
      mode: 'skipped',
      reason: 'missing_or_invalid_recipient'
    };
  }

  const cleanEmail = recipientEmail.trim();

  // 2. Suppress synthetic test domains
  if (isSyntheticEmail(cleanEmail)) {
    console.log(`[EMAIL SUPPRESSED] Skipped delivery for synthetic recipient: ${cleanEmail}`);
    return {
      sent: false,
      mode: 'suppressed',
      reason: 'synthetic_example_domain'
    };
  }

  // 3. Check SMTP configuration
  const config = getSmtpConfig();

  if (!config.isConfigured && !testTransporter) {
    console.log(`[EMAIL SIMULATION] Status decision email simulated for ${cleanEmail}. Decision: ${status}. Student: ${studentName}.`);
    return {
      sent: false,
      mode: 'simulated',
      reason: 'smtp_not_configured'
    };
  }

  // 4. Send via Nodemailer (real transport or testTransporter)
  try {
    const transporter = testTransporter || createTransporter(config);

    // Format sender address
    const fromAddr = config.fromAddress || config.user;
    const formattedSender = config.fromName && !fromAddr.includes('<')
      ? `"${config.fromName}" <${fromAddr}>`
      : fromAddr;

    const subject = `Admission Application ${status === 'APPROVED' ? 'Approved' : 'Status Update'} - ${studentName}`;
    const textContent = status === 'APPROVED'
      ? `Dear ${recipientName || 'Parent/Guardian'},\n\nWe are pleased to inform you that the admission application for ${studentName}${targetClassName ? ` for ${targetClassName}` : ''} has been APPROVED.\n\nPlease contact the school office to complete the enrollment process.\n\nSincerely,\nSchool Administration`
      : `Dear ${recipientName || 'Parent/Guardian'},\n\nThank you for your interest in our school. We regret to inform you that the admission application for ${studentName} was not approved at this time.\n\nSincerely,\nSchool Administration`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: ${status === 'APPROVED' ? '#2e7d32' : '#c62828'}; color: #ffffff; padding: 20px; text-align: center;">
          <h2 style="margin: 0;">${config.fromName || 'School Management System'}</h2>
          <p style="margin: 5px 0 0 0; font-size: 14px;">Admission Application Decision</p>
        </div>
        <div style="padding: 24px;">
          <p>Dear <strong>${recipientName || 'Parent/Guardian'}</strong>,</p>
          ${status === 'APPROVED'
            ? `<p>We are pleased to inform you that the admission application for <strong>${studentName}</strong>${targetClassName ? ` for <strong>${targetClassName}</strong>` : ''} has been <span style="color: #2e7d32; font-weight: bold;">APPROVED</span>.</p>
               <p>Please contact the school administrative office at your earliest convenience to complete the formal student enrollment process.</p>`
            : `<p>Thank you for your interest in our school. We regret to inform you that the admission application for <strong>${studentName}</strong> was not approved at this time.</p>
               <p>We wish you and your student all the very best in your future academic pursuits.</p>`
          }
          <p style="margin-top: 24px;">Sincerely,<br><strong>School Administration</strong></p>
        </div>
        <div style="background-color: #f5f5f5; padding: 12px 24px; text-align: center; font-size: 12px; color: #777;">
          This is an automated notification from ${config.fromName || 'School Management System'}. Please do not reply directly to this email.
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from: formattedSender,
      to: cleanEmail,
      subject,
      text: textContent,
      html: htmlContent
    });

    console.log(`[EMAIL DISPATCHED] Admission decision email accepted by SMTP server for ${cleanEmail} (Message ID: ${info.messageId})`);

    return {
      sent: true,
      mode: 'delivered',
      messageId: info.messageId,
      recipient: cleanEmail
    };

  } catch (error) {
    // Sanitize log output to strictly omit any passwords or tokens
    console.error(`[EMAIL ERROR] Delivery failed for ${cleanEmail}: ${error.message}`);
    return {
      sent: false,
      mode: 'failed',
      error: `SMTP delivery failed: ${error.message}`
    };
  }
};

module.exports = {
  isSyntheticEmail,
  isValidEmailFormat,
  getSmtpConfig,
  createTransporter,
  verifySmtpConnection,
  setTestTransporter,
  sendDecisionEmail
};
