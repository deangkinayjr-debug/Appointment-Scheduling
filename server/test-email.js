const { Resend } = require('resend');
require('dotenv').config({ path: '../.env' });

const resend = new Resend(process.env.RESEND_API_KEY);
console.log('API Key na nababasa:', process.env.RESEND_API_KEY);
async function testEmail() {
  try {
    console.log('Sinusubukang magpadala ng email gamit ang API key...');
    const data = await resend.emails.send({
      from: 'ICCT Registrar <onboarding@resend.dev>',
      to: process.env.EMAIL_TO,
      subject: 'Test Resend Email',
      html: '<p>Gumagana na ang Resend sa app mo!</p>'
    });
    console.log('RESULTA NG RESEND:', data);
  } catch (error) {
    console.error('ERROR SA RESEND:', error);
  }
}

testEmail();