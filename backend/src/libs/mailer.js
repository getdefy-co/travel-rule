import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { logger } from '@libs';
import { errorDB } from '@database';

let emailConfig = { mode: 'disabled' };
let transporter = null;

const configure = async config => {
  emailConfig = { mode: 'disabled' };
  transporter = null;

  if (config.mode === 'disabled') {
    return;
  }

  const candidate = nodemailer.createTransport({
    auth: {
      pass: config.password,
      user: config.user,
    },
    host: config.host,
    port: config.port,
    secure: config.secure,
  });

  try {
    await candidate.verify();
  } catch (_error) {
    logger.error('[MAILER] SMTP initialization failed.');
    throw new Error('SMTP initialization failed.');
  }

  emailConfig = config;
  transporter = candidate;
};

function getWelcomeTemplate(data) {
  const templatePath = path.join(__dirname, '../templates', 'welcomeToDefy.html');
  let template = fs.readFileSync(templatePath, 'utf8');
  const url = `${emailConfig.frontendUrl}/login?rpt=${data.token}&t=0`;

  template = template?.replaceAll('{{userEmail}}', data.email);
  template = template?.replaceAll('{{url}}', url);
  template = template?.replaceAll('{{currentYear}}', new Date().getFullYear());

  return template;
}

function getForgotPasswordTemplate(data) {
  const templatePath = path.join(__dirname, '../templates', 'forgotPassword.html');
  let template = fs.readFileSync(templatePath, 'utf8');
  const url = `${emailConfig.frontendUrl}/login?rpt=${data.token}&t=1`;

  template = template?.replaceAll('{{userEmail}}', data.email);
  template = template?.replaceAll('{{url}}', url);
  template = template?.replaceAll('{{currentYear}}', new Date().getFullYear());

  return template;
}

const deliver = async ({ email, html, logPrefix, name, subject }) => {
  try {
    await transporter.sendMail({
      from: `Defy <${emailConfig.user}>`,
      to: email,
      subject,
      html,
    });
    logger.info(`[${logPrefix}] Email sent.`);
  } catch (error) {
    await errorDB.writeError({
      name,
      message: 'Email delivery failed.',
      status: error?.response?.status || error?.statusCode || 500,
      details: { email },
    });
    logger.error(`[${logPrefix}] Email delivery failed.`);
  }
};

const isEnabled = () => {
  return Boolean(transporter);
};

const sendTravelRuleAccessEmail = async ({ email, token }) => {
  if (!transporter) {
    throw new Error('Email delivery is disabled.');
  }

  const url = `${emailConfig.frontendUrl}/travel-rule/shared#token=${token}`;
  const html = [
    `<!doctype html><html><body><p>A Travel Rule transfer has been shared with you.</p><p><a href="${url}">View transfer</a></p>`,
    '<p>This single-use link expires in 30 days.</p></body></html>',
  ].join('');

  try {
    await transporter.sendMail({
      from: `Defy <${emailConfig.user}>`,
      html,
      subject: 'Travel Rule transfer details',
      to: email,
    });
    logger.info('[SEND_TRAVEL_RULE_EMAIL] Email sent.');
  } catch (_error) {
    logger.error('[SEND_TRAVEL_RULE_EMAIL] Email delivery failed.');
    throw new Error('Travel Rule email delivery failed.');
  }
};

const sendWelcomeEmail = async ({ email, token }) => {
  if (!transporter) {
    return;
  }

  return deliver({
    email,
    html: getWelcomeTemplate({ email, token }),
    logPrefix: 'SEND_WELCOME_EMAIL',
    name: 'libs/mailer/sendWelcomeEmail',
    subject: 'Welcome to Defy',
  });
};

const sendForgotPasswordEmail = async ({ email, token }) => {
  if (!transporter) {
    return;
  }

  return deliver({
    email,
    html: getForgotPasswordTemplate({ email, token }),
    logPrefix: 'SEND_FORGOT_PASSWORD_EMAIL',
    name: 'libs/mailer/sendForgotPasswordEmail',
    subject: 'Reset Your Password',
  });
};

export default {
  configure,
  isEnabled,
  sendTravelRuleAccessEmail,
  sendWelcomeEmail,
  sendForgotPasswordEmail,
};
