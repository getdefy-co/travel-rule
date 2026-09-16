import nodemailer from 'nodemailer';

const { version } = require('nodemailer/package.json');

describe('Nodemailer compatibility', () => {
  test('uses Nodemailer 9 to compose a message without network access', async () => {
    expect(version).toMatch(/^9\./);

    const transporter = nodemailer.createTransport({
      buffer: true,
      newline: 'unix',
      streamTransport: true,
    });

    const result = await transporter.sendMail({
      from: 'sender@example.test',
      subject: 'Nodemailer compatibility',
      text: 'Compatibility check',
      to: 'recipient@example.test',
    });

    expect(result.message.toString()).toEqual(expect.stringContaining('Subject: Nodemailer compatibility'));
    expect(result.message.toString()).toEqual(expect.stringContaining('Compatibility check'));
  });
});
