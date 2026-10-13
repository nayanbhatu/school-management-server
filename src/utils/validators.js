/**
 * Comprehensive input validation utilities for School Operations Management System
 */

/**
 * Known common typos in Top-Level Domains (TLDs) and their intended corrections.
 * These are never legitimate IANA TLDs.
 */
const COMMON_TLD_TYPOS = {
  comm: 'com',
  cmo: 'com',
  con: 'com',
  coom: 'com',
  cpm: 'com',
  xom: 'com',
  ocm: 'com',
  vom: 'com',
  clm: 'com',
  col: 'com',
  kom: 'com',
  comn: 'com',
  nett: 'net',
  nte: 'net',
  ner: 'net',
  orgg: 'org',
  ogr: 'org',
  eduu: 'edu',
  eddu: 'edu',
  govv: 'gov'
};

/**
 * Common typos in major webmail provider domains.
 */
const COMMON_DOMAIN_TYPOS = {
  'gmai.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'outlok.com': 'outlook.com'
};

/**
 * Validates an email address format, length, and common typo errors.
 * - Trims leading/trailing whitespace
 * - Checks length limits (between 5 and 150 characters)
 * - Ensures valid structure with exactly one '@'
 * - Requires alphabetic TLD of 2-63 characters
 * - Rejects consecutive dots and starting/ending dots
 * - Detects common likely typos such as .comm, .cmo, .con
 * - Preserves acceptance of all legitimate IANA TLDs and unfamiliar domains (e.g., .in, .org, .edu, .io, .ai, .school)
 * 
 * @param {string} email
 * @returns {{ isValid: boolean, normalized?: string, message?: string }}
 */
const validateEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return { isValid: false, message: 'Email address is required' };
  }

  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return { isValid: false, message: 'Email address cannot be empty' };
  }

  if (trimmed.length < 5 || trimmed.length > 150) {
    return { isValid: false, message: 'Email address must be between 5 and 150 characters' };
  }

  if (trimmed.includes(' ')) {
    return { isValid: false, message: 'Email address cannot contain spaces' };
  }

  // Must contain exactly one '@'
  const atParts = trimmed.split('@');
  if (atParts.length !== 2) {
    return { isValid: false, message: 'Email address must contain exactly one "@" symbol' };
  }

  const [localPart, domainPart] = atParts;
  if (!localPart || !domainPart) {
    return { isValid: false, message: 'Email address must have a username and domain part' };
  }

  // Disallow consecutive dots
  if (trimmed.includes('..')) {
    return { isValid: false, message: 'Email address cannot contain consecutive dots ("..")' };
  }

  // Disallow leading or trailing dot in local part or domain part
  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    return { isValid: false, message: 'Email username cannot start or end with a dot' };
  }
  if (domainPart.startsWith('.') || domainPart.endsWith('.')) {
    return { isValid: false, message: 'Email domain cannot start or end with a dot' };
  }

  // General RFC-compatible regex requiring alphabetic TLD of 2-63 chars
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/;
  if (!emailRegex.test(trimmed)) {
    return { isValid: false, message: 'Please enter a valid email address format (e.g. name@example.com)' };
  }

  const domainLower = domainPart.toLowerCase();
  const domainSegments = domainLower.split('.');
  const tld = domainSegments[domainSegments.length - 1];

  // Check for common TLD typos (.comm, .cmo, .con, etc.)
  if (COMMON_TLD_TYPOS[tld]) {
    const suggestedTld = COMMON_TLD_TYPOS[tld];
    return {
      isValid: false,
      message: `The email domain ends with ".${tld}", which appears to be a typo for ".${suggestedTld}". Please check your email address.`
    };
  }

  // Check for common webmail domain typos (gmai.com, gamil.com, etc.)
  if (COMMON_DOMAIN_TYPOS[domainLower]) {
    const suggestedDomain = COMMON_DOMAIN_TYPOS[domainLower];
    return {
      isValid: false,
      message: `The domain "@${domainLower}" appears to be a typo for "@${suggestedDomain}". Please check your email address.`
    };
  }

  const normalized = `${localPart}@${domainLower}`;
  return { isValid: true, normalized };
};

/**
 * Validates an email address format and length (boolean helper)
 * @param {string} email
 * @returns {boolean}
 */
const isValidEmail = (email) => {
  return validateEmail(email).isValid;
};

/**
 * Validates and normalizes Indian mobile phone numbers
 * Requirements:
 * - Must not contain letters or disallowed characters
 * - Permitted formatting: spaces, hyphens, optional leading '+91', '91', or '0'
 * - Exactly 10 digits after removing permitted formatting
 * - First digit must be in the accepted Indian mobile range [6-9]
 * - Does not silently truncate invalid input
 * 
 * @param {string} phone
 * @returns {{ isValid: boolean, normalized?: string, message?: string }}
 */
const validateIndianPhoneNumber = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, message: 'Phone number is required and must be a string' };
  }

  const trimmed = phone.trim();
  if (trimmed.length === 0) {
    return { isValid: false, message: 'Phone number cannot be empty' };
  }

  // Reject any alphabetic characters or symbols (allow only digits, spaces, hyphens, optional leading +)
  if (/[a-zA-Z]/.test(trimmed)) {
    return { isValid: false, message: 'Phone number cannot contain letters' };
  }

  // Check for allowed characters only: digits, spaces, hyphens, parentheses, optional leading +
  if (!/^\+?[0-9\s\-()]+$/.test(trimmed)) {
    return { isValid: false, message: 'Phone number contains invalid special characters' };
  }

  // Strip allowed formatting characters: spaces, hyphens, parentheses
  let digits = trimmed.replace(/[\s\-()]/g, '');

  // Handle leading country code (+91 or 91) or leading trunk zero (0)
  if (digits.startsWith('+91')) {
    digits = digits.slice(3);
  } else if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1);
  } else if (digits.startsWith('+')) {
    return { isValid: false, message: 'Invalid country code. Expected Indian mobile number (+91)' };
  }

  // Must consist of digits only now
  if (!/^\d+$/.test(digits)) {
    return { isValid: false, message: 'Phone number contains invalid characters' };
  }

  // Must be exactly 10 digits
  if (digits.length !== 10) {
    return {
      isValid: false,
      message: `Indian mobile number must be exactly 10 digits (received ${digits.length} digits)`
    };
  }

  // First digit must be in [6-9]
  if (!/^[6-9]/.test(digits)) {
    return {
      isValid: false,
      message: `Indian mobile number must start with 6, 7, 8, or 9 (starts with '${digits[0]}')`
    };
  }

  return { isValid: true, normalized: digits };
};

/**
 * Validates date of birth (must be a valid past date in YYYY-MM-DD format)
 * @param {string} dateStr
 * @returns {{ isValid: boolean, message?: string }}
 */
const isValidPastDate = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { isValid: false, message: 'Date of birth is required and must follow YYYY-MM-DD format' };
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const dateObj = new Date(year, month - 1, day);

  if (
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() !== month - 1 ||
    dateObj.getDate() !== day
  ) {
    return { isValid: false, message: 'Date of birth is not a valid calendar date' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (dateObj >= today) {
    return { isValid: false, message: 'Date of birth must be a past date' };
  }

  // Reasonable lower bound check (e.g. student born within last 100 years)
  if (year < 1920) {
    return { isValid: false, message: 'Date of birth year is unreasonably early' };
  }

  return { isValid: true };
};

/**
 * Validates academic year format (e.g. '2026-2027')
 * @param {string} yearStr
 * @returns {boolean}
 */
const isValidAcademicYear = (yearStr) => {
  if (!yearStr || typeof yearStr !== 'string') return false;
  const trimmed = yearStr.trim();
  if (!/^\d{4}-\d{4}$/.test(trimmed)) return false;

  const [start, end] = trimmed.split('-').map(Number);
  return end === start + 1;
};

/**
 * Validates positive integers
 * @param {*} val
 * @returns {boolean}
 */
const isValidPositiveInteger = (val) => {
  if (val === undefined || val === null || val === '') return false;
  const num = Number(val);
  return Number.isInteger(num) && num > 0;
};

module.exports = {
  validateEmail,
  isValidEmail,
  validateIndianPhoneNumber,
  isValidPastDate,
  isValidAcademicYear,
  isValidPositiveInteger
};
